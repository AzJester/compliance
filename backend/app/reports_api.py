from __future__ import annotations

import re
import unicodedata
from collections import Counter
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from .config import Settings
from .database import get_session
from .models import (
    SOLICITATION_DOCUMENT_CLASSIFICATIONS,
    CrosswalkFinding,
    CrosswalkRunState,
    CrosswalkStatus,
    Document,
    DocumentClassification,
    DocumentProfile,
    Project,
    ProjectAction,
    ProposalEvidence,
    Requirement,
    Sensitivity,
    ValidationStatus,
    utc_now,
)
from .reporting import (
    DOCX_MEDIA_TYPE,
    GAP_CSV_MEDIA_TYPE,
    ComplianceReportData,
    ReportAction,
    ReportDocument,
    ReportEvidence,
    ReportFinding,
    ReportRequirement,
    build_compliance_report,
    build_gap_csv,
)
from .workflow_api import (
    _is_usable_proposal_document,
    _proposal_input_signature,
    _requirement_input_signature,
)

router = APIRouter(prefix="/api/projects/{project_id}", tags=["reports"])

_FILENAME_UNSAFE = re.compile(r"[^\w.-]+", flags=re.UNICODE)
_ASCII_FILENAME_UNSAFE = re.compile(r"[^a-z0-9.-]+")


def _project(session: Session, project_id: str) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


def _ensure_export_allowed(project: Project, settings: Settings) -> None:
    if (
        settings.web_enabled
        and settings.web_access_mode == "anonymous"
        and project.sensitivity != Sensitivity.PUBLIC
    ):
        raise HTTPException(
            status_code=403,
            detail="Anonymous public deployments can export only PUBLIC projects.",
        )


def _filename_slug(project: Project) -> tuple[str, str]:
    raw = f"{project.solicitation_number or project.name}-{project.name}".strip()
    unicode_slug = _FILENAME_UNSAFE.sub("-", raw).strip("-._")[:100]
    if not unicode_slug:
        unicode_slug = f"project-{project.id[:8]}"
    normalized = unicodedata.normalize("NFKD", unicode_slug).encode("ascii", "ignore").decode()
    ascii_slug = _ASCII_FILENAME_UNSAFE.sub("-", normalized.casefold()).strip("-.")[:80]
    if not ascii_slug:
        ascii_slug = f"project-{project.id[:8]}"
    return ascii_slug, unicode_slug


def _content_disposition(project: Project, suffix: str) -> str:
    ascii_slug, unicode_slug = _filename_slug(project)
    fallback = f"{ascii_slug}-{suffix}"
    encoded = quote(f"{unicode_slug}-{suffix}", safe="")
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"


def _active_requirements(session: Session, project_id: str) -> list[Requirement]:
    return list(
        session.scalars(
            select(Requirement)
            .join(Document, Document.id == Requirement.document_id)
            .outerjoin(DocumentProfile, DocumentProfile.document_id == Document.id)
            .options(selectinload(Requirement.document))
            .where(
                Requirement.project_id == project_id,
                Requirement.validation_status != ValidationStatus.DISMISSED,
                or_(
                    DocumentProfile.document_id.is_(None),
                    DocumentProfile.classification.in_(SOLICITATION_DOCUMENT_CLASSIFICATIONS),
                ),
            )
            .order_by(
                Requirement.section,
                Requirement.document_id,
                Requirement.source_start,
                Requirement.id,
            )
        )
    )


def _project_documents(session: Session, project_id: str) -> list[Document]:
    return list(
        session.scalars(
            select(Document)
            .options(selectinload(Document.workflow_profile))
            .where(Document.project_id == project_id)
            .order_by(Document.created_at, Document.id)
        )
    )


def _active_findings(
    session: Session,
    project_id: str,
    requirement_ids: set[str],
) -> list[CrosswalkFinding]:
    if not requirement_ids:
        return []
    return list(
        session.scalars(
            select(CrosswalkFinding)
            .options(
                selectinload(CrosswalkFinding.evidence)
                .selectinload(ProposalEvidence.document)
                .selectinload(Document.workflow_profile)
            )
            .where(
                CrosswalkFinding.project_id == project_id,
                CrosswalkFinding.requirement_id.in_(requirement_ids),
            )
            .order_by(CrosswalkFinding.requirement_id)
        )
    )


def _deduplicated_usable_proposals(documents: list[Document]) -> list[Document]:
    usable = [
        document
        for document in documents
        if document.classification == DocumentClassification.PROPOSAL_VOLUME
        and _is_usable_proposal_document(document)
    ]
    deduplicated: list[Document] = []
    seen: set[tuple[str, str]] = set()
    for document in usable:
        key = (document.blob_sha256, document.content_type)
        if key in seen:
            continue
        deduplicated.append(document)
        seen.add(key)
    return deduplicated


def _analysis_messages(
    session: Session,
    project: Project,
    documents: list[Document],
    requirements: list[Requirement],
    findings: list[CrosswalkFinding],
) -> tuple[bool, tuple[str, ...]]:
    messages: list[str] = []
    proposals = [
        document
        for document in documents
        if document.classification == DocumentClassification.PROPOSAL_VOLUME
    ]
    usable_proposals = _deduplicated_usable_proposals(documents)
    if not requirements:
        messages.append("No active solicitation requirements are available for assessment.")
    if not proposals:
        messages.append("No proposal volume is in scope.")
    elif not usable_proposals:
        messages.append("No proposal volume contains usable extracted text.")
    elif len(usable_proposals) < len(proposals):
        messages.append(
            f"{len(proposals) - len(usable_proposals)} proposal volume(s) are blank, unusable, or "
            "duplicate and were not analyzed."
        )
    if len(findings) < len(requirements):
        messages.append(
            f"Analysis is incomplete: {len(findings):,} of {len(requirements):,} active "
            "requirements have findings."
        )

    run_state = session.get(CrosswalkRunState, project.id)
    inputs_current = bool(
        run_state is not None
        and requirements
        and usable_proposals
        and run_state.requirement_signature == _requirement_input_signature(requirements)
        and run_state.proposal_signature == _proposal_input_signature(proposals)
    )
    if findings and not inputs_current:
        messages.append(
            "Solicitation or proposal inputs do not match the latest completed analysis run."
        )
    stale = sum(finding.stale for finding in findings)
    if stale:
        messages.append(f"{stale:,} finding(s) are marked stale and require reanalysis.")
    invalid_evidence = sum(
        finding.status
        in {
            CrosswalkStatus.COVERED,
            CrosswalkStatus.PARTIAL,
            CrosswalkStatus.CONFLICT,
        }
        and (
            not finding.evidence
            or any(
                evidence.document.classification != DocumentClassification.PROPOSAL_VOLUME
                for evidence in finding.evidence
            )
        )
        for finding in findings
    )
    if invalid_evidence:
        messages.append(
            f"{invalid_evidence:,} covered, partial, or conflict finding(s) lack valid proposal "
            "evidence."
        )
    unreviewed_overrides = sum(
        finding.status != finding.candidate_status and not finding.human_verified
        for finding in findings
    )
    if unreviewed_overrides:
        messages.append(
            f"{unreviewed_overrides:,} manual status override(s) lack reviewer confirmation."
        )
    current = bool(
        requirements
        and usable_proposals
        and len(findings) == len(requirements)
        and inputs_current
        and not stale
        and not invalid_evidence
        and not unreviewed_overrides
    )
    return current, tuple(messages)


def _report_data(
    session: Session,
    project: Project,
    settings: Settings,
) -> ComplianceReportData:
    documents = _project_documents(session, project.id)
    requirements = _active_requirements(session, project.id)
    findings = _active_findings(session, project.id, {item.id for item in requirements})
    actions = list(
        session.scalars(
            select(ProjectAction)
            .where(ProjectAction.project_id == project.id)
            .order_by(ProjectAction.status, ProjectAction.due_at, ProjectAction.created_at)
        )
    )
    current, messages = _analysis_messages(
        session,
        project,
        documents,
        requirements,
        findings,
    )
    findings_by_requirement = {finding.requirement_id: finding for finding in findings}

    requirement_snapshots: list[ReportRequirement] = []
    for requirement in requirements:
        finding = findings_by_requirement.get(requirement.id)
        finding_snapshot = None
        if finding is not None:
            evidence = tuple(
                ReportEvidence(
                    document_name=item.document.name,
                    source_locator=item.source_locator,
                    excerpt=item.excerpt,
                    score=item.score,
                    is_manual=item.is_manual,
                )
                for item in sorted(
                    finding.evidence,
                    key=lambda item: (
                        not item.is_manual,
                        -item.score,
                        item.source_locator.casefold(),
                        item.id,
                    ),
                )
            )
            evidence_source_valid = all(
                item.document.classification == DocumentClassification.PROPOSAL_VOLUME
                for item in finding.evidence
            )
            evidence_required = finding.status in {
                CrosswalkStatus.COVERED,
                CrosswalkStatus.PARTIAL,
                CrosswalkStatus.CONFLICT,
            }
            evidence_valid = evidence_source_valid and (
                bool(finding.evidence) or not evidence_required
            )
            finding_snapshot = ReportFinding(
                id=finding.id,
                requirement_id=finding.requirement_id,
                candidate_status=finding.candidate_status.value,
                status=finding.status.value,
                score=finding.score,
                human_verified=finding.human_verified,
                stale=finding.stale,
                reviewer=finding.reviewer,
                owner=finding.owner,
                due_at=finding.due_at,
                notes=finding.notes,
                evidence_valid=evidence_valid,
                evidence=evidence,
            )
        requirement_snapshots.append(
            ReportRequirement(
                id=requirement.id,
                section=requirement.section.value,
                category=requirement.category.value,
                mandatory_term=requirement.mandatory_term,
                obligation_owner=requirement.obligation_owner.value,
                requirement_text=requirement.requirement_text,
                source_document=requirement.document.name,
                source_locator=requirement.source_locator,
                finding=finding_snapshot,
            )
        )

    return ComplianceReportData(
        project_id=project.id,
        project_name=project.name,
        solicitation_number=project.solicitation_number,
        agency=project.agency,
        due_at=project.due_at,
        due_timezone=project.due_timezone,
        sensitivity=project.sensitivity.value,
        generated_at=utc_now(),
        anonymous_public=settings.web_enabled and settings.web_access_mode == "anonymous",
        analysis_current=current,
        analysis_messages=messages,
        documents=tuple(
            ReportDocument(
                name=document.name,
                classification=document.classification.value,
                status=document.status.value,
                volume_name=document.volume_name,
                extraction_count=document.extraction_count,
                duplicate=document.duplicate_of is not None,
            )
            for document in documents
        ),
        requirements=tuple(requirement_snapshots),
        actions=tuple(
            ReportAction(
                id=action.id,
                title=action.title,
                description=action.description,
                status=action.status.value,
                owner=action.owner,
                due_at=action.due_at,
                requirement_id=action.requirement_id,
                finding_id=action.finding_id,
            )
            for action in actions
        ),
    )


def _report_headers(project: Project, suffix: str) -> dict[str, str]:
    return {
        "Content-Disposition": _content_disposition(project, suffix),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    }


@router.get("/exports/compliance-report.docx", response_model=None)
def export_compliance_report(
    project_id: str,
    request: Request,
    session: Session = Depends(get_session),
) -> Response:
    project = _project(session, project_id)
    settings: Settings = request.app.state.settings
    _ensure_export_allowed(project, settings)
    report = build_compliance_report(_report_data(session, project, settings))
    return Response(
        content=report,
        media_type=DOCX_MEDIA_TYPE,
        headers=_report_headers(project, "compliance-report.docx"),
    )


@router.get("/exports/gaps.csv", response_model=None)
def export_gap_register(
    project_id: str,
    request: Request,
    session: Session = Depends(get_session),
) -> Response:
    project = _project(session, project_id)
    settings: Settings = request.app.state.settings
    _ensure_export_allowed(project, settings)
    data = _report_data(session, project, settings)
    if not any(requirement.finding is not None for requirement in data.requirements):
        raise HTTPException(
            status_code=409,
            detail="Analyze the proposal before creating a requirements gap report.",
        )
    if not data.analysis_current:
        raise HTTPException(
            status_code=409,
            detail="Reanalyze the proposal before creating a requirements gap report.",
        )
    csv_bytes = build_gap_csv(data)
    return Response(
        content=csv_bytes,
        media_type=GAP_CSV_MEDIA_TYPE,
        headers=_report_headers(project, "gaps.csv"),
    )


def report_status_counts(data: ComplianceReportData) -> Counter[str]:
    """Stable helper for report endpoint regression tests and future UI summaries."""

    return Counter(
        requirement.finding.status if requirement.finding is not None else "NOT_ANALYZED"
        for requirement in data.requirements
    )
