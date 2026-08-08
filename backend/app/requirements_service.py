from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

from .config import Settings
from .models import (
    CDRL,
    Document,
    DocumentStatus,
    Project,
    Requirement,
    ReviewAction,
    ReviewDecision,
    ValidationStatus,
    utc_now,
)
from .requirements_rules import (
    EXTRACTION_METHOD,
    RULE_VERSION,
    CDRLCandidate,
    ExtractionLimitError,
    RequirementCandidate,
    analyze_document,
)
from .schemas import CDRLResponse, ExtractionSummary, RequirementPatch


@dataclass(slots=True)
class _Counters:
    documents_analyzed: int = 0
    requirements_created: int = 0
    requirements_reused: int = 0
    cdrls_created: int = 0
    cdrls_reused: int = 0


@dataclass(frozen=True, slots=True)
class _DocumentAnalysis:
    document: Document
    requirements: list[RequirementCandidate]
    cdrls: list[CDRLCandidate]


class StaleRequirementError(Exception):
    """The requirement changed after the reviewer loaded it."""


def _new_requirement(
    project_id: str, document: Document, candidate: RequirementCandidate
) -> Requirement:
    return Requirement(
        project_id=project_id,
        document_id=document.id,
        fingerprint=candidate.fingerprint,
        source_text=candidate.source_text,
        source_start=candidate.source_start,
        source_end=candidate.source_end,
        source_locator=candidate.source_locator,
        requirement_text=candidate.requirement_text,
        section=candidate.section,
        category=candidate.category,
        mandatory_term=candidate.mandatory_term,
        obligation_owner=candidate.obligation_owner,
        applicability=candidate.applicability,
        confidence=candidate.confidence,
        extraction_method=EXTRACTION_METHOD,
        rule_version=RULE_VERSION,
        validation_status=ValidationStatus.PENDING,
    )


def _new_cdrl(
    project_id: str,
    document: Document,
    requirement: Requirement,
    candidate: CDRLCandidate,
) -> CDRL:
    return CDRL(
        project_id=project_id,
        document_id=document.id,
        requirement_id=requirement.id,
        fingerprint=candidate.fingerprint,
        source_text=candidate.source_text,
        source_start=candidate.source_start,
        source_end=candidate.source_end,
        source_locator=candidate.source_locator,
        extraction_method=EXTRACTION_METHOD,
        rule_version=RULE_VERSION,
        incomplete=bool(candidate.missing_fields) or candidate.source_truncated,
        missing_fields=candidate.missing_fields,
        source_truncated=candidate.source_truncated,
        **candidate.fields,
    )


def extract_project_register(
    session: Session, project: Project, settings: Settings
) -> ExtractionSummary:
    documents = list(
        session.scalars(
            select(Document)
            .options(selectinload(Document.blob))
            .where(
                Document.project_id == project.id,
                Document.status == DocumentStatus.EXTRACTED,
            )
            .order_by(Document.created_at, Document.id)
        )
    )
    counters = _Counters()
    seen_document_content: set[tuple[str, str]] = set()
    analyses: list[_DocumentAnalysis] = []
    requirement_candidates_in_run = 0
    cdrl_candidates_in_run = 0

    # Candidate generation and every safety check complete before the first insert.
    for document in documents:
        content_key = (document.blob_sha256, document.content_type)
        if content_key in seen_document_content:
            continue
        seen_document_content.add(content_key)
        requirement_candidates, cdrl_candidates = analyze_document(
            document,
            max_requirement_candidates=(settings.max_requirement_candidates_per_document),
            max_cdrl_candidates=settings.max_cdrl_candidates_per_document,
        )
        requirement_candidates_in_run += len(requirement_candidates)
        cdrl_candidates_in_run += len(cdrl_candidates)
        if requirement_candidates_in_run > settings.max_requirement_candidates_per_run:
            raise ExtractionLimitError(
                "Requirement extraction exceeded the per-run safety limit of "
                f"{settings.max_requirement_candidates_per_run} candidates."
            )
        if cdrl_candidates_in_run > settings.max_cdrl_candidates_per_run:
            raise ExtractionLimitError(
                "CDRL extraction exceeded the per-run safety limit of "
                f"{settings.max_cdrl_candidates_per_run} candidates."
            )
        analyses.append(
            _DocumentAnalysis(
                document=document,
                requirements=requirement_candidates,
                cdrls=cdrl_candidates,
            )
        )
        counters.documents_analyzed += 1

    existing_requirements = {
        requirement.fingerprint: requirement
        for requirement in session.scalars(
            select(Requirement).where(Requirement.project_id == project.id)
        )
    }
    existing_cdrls = {
        cdrl.fingerprint: cdrl
        for cdrl in session.scalars(select(CDRL).where(CDRL.project_id == project.id))
    }

    for analysis in analyses:
        document = analysis.document
        document_requirements: dict[str, Requirement] = {}
        for candidate in analysis.requirements:
            requirement = existing_requirements.get(candidate.fingerprint)
            if requirement is None:
                requirement = _new_requirement(project.id, document, candidate)
                session.add(requirement)
                session.flush()
                existing_requirements[candidate.fingerprint] = requirement
                counters.requirements_created += 1
            else:
                counters.requirements_reused += 1
            document_requirements[candidate.fingerprint] = requirement

        for candidate in analysis.cdrls:
            cdrl = existing_cdrls.get(candidate.fingerprint)
            if cdrl is None:
                requirement = document_requirements[candidate.requirement.fingerprint]
                cdrl = _new_cdrl(project.id, document, requirement, candidate)
                session.add(cdrl)
                session.flush()
                existing_cdrls[candidate.fingerprint] = cdrl
                counters.cdrls_created += 1
            else:
                counters.cdrls_reused += 1

    total_requirements = session.scalar(
        select(func.count(Requirement.id)).where(Requirement.project_id == project.id)
    )
    pending_requirements = session.scalar(
        select(func.count(Requirement.id)).where(
            Requirement.project_id == project.id,
            Requirement.validation_status == ValidationStatus.PENDING,
        )
    )
    return ExtractionSummary(
        documents_analyzed=counters.documents_analyzed,
        requirements_created=counters.requirements_created,
        requirements_reused=counters.requirements_reused,
        cdrls_created=counters.cdrls_created,
        cdrls_reused=counters.cdrls_reused,
        total_requirements=total_requirements or 0,
        pending_requirements=pending_requirements or 0,
    )


_EDITABLE_FIELDS = (
    "requirement_text",
    "section",
    "category",
    "obligation_owner",
    "applicability",
    "validation_status",
)


def _state(requirement: Requirement) -> dict[str, object]:
    return {
        "requirement_text": requirement.requirement_text,
        "section": requirement.section.value,
        "category": requirement.category.value,
        "obligation_owner": requirement.obligation_owner.value,
        "applicability": requirement.applicability.value,
        "validation_status": requirement.validation_status.value,
        "reviewer": requirement.reviewer,
        "review_note": requirement.review_note,
        "dismissal_reason": requirement.dismissal_reason,
    }


def apply_requirement_patch(
    session: Session, requirement: Requirement, patch: RequirementPatch
) -> ReviewDecision:
    previous = _state(requirement)
    values = patch.model_dump(exclude_unset=True)
    update_values: dict[str, object] = {
        field: values[field] for field in _EDITABLE_FIELDS if field in values
    }
    update_values["reviewer"] = patch.reviewer
    if "review_note" in patch.model_fields_set:
        update_values["review_note"] = patch.review_note

    target_status = update_values.get("validation_status", requirement.validation_status)
    if "validation_status" in patch.model_fields_set:
        update_values["dismissal_reason"] = (
            patch.review_note if target_status == ValidationStatus.DISMISSED else None
        )
    update_values["updated_at"] = max(utc_now(), requirement.updated_at + timedelta(microseconds=1))

    result = session.execute(
        update(Requirement)
        .where(
            Requirement.id == requirement.id,
            Requirement.project_id == requirement.project_id,
            Requirement.updated_at == patch.expected_updated_at,
        )
        .values(**update_values)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:  # type: ignore[attr-defined]
        raise StaleRequirementError(
            "Requirement changed after it was loaded; refresh and review the latest version."
        )
    session.refresh(requirement)

    previous_status = ValidationStatus(previous["validation_status"])
    if (
        "validation_status" in patch.model_fields_set
        and requirement.validation_status == ValidationStatus.DISMISSED
    ):
        action = ReviewAction.DISMISSED
    elif (
        "validation_status" in patch.model_fields_set
        and requirement.validation_status == ValidationStatus.VALIDATED
    ):
        action = ReviewAction.VALIDATED
    elif (
        "validation_status" in patch.model_fields_set
        and previous_status != ValidationStatus.PENDING
    ):
        action = ReviewAction.REOPENED
    else:
        action = ReviewAction.UPDATED

    current = _state(requirement)
    decision = ReviewDecision(
        project_id=requirement.project_id,
        requirement_id=requirement.id,
        reviewer=patch.reviewer,
        action=action,
        previous_state=previous,
        new_state=current,
        note=patch.review_note,
    )
    session.add(decision)

    if requirement.cdrl is not None:
        requirement.cdrl.validation_status = requirement.validation_status
        requirement.cdrl.reviewer = patch.reviewer
        requirement.cdrl.reviewed_at = requirement.updated_at
        requirement.cdrl.updated_at = requirement.updated_at
    session.flush()
    return decision


_CDRL_BLOCK_MAP = {
    "block_a": "block_a_contract_line_item_number",
    "block_b": "block_b_exhibit",
    "block_c": "block_c_category",
    "block_d": "block_d_system_item",
    "block_e": "block_e_contract_pr_number",
    "block_f": "block_f_contractor",
    "block_1": "block_1_data_item_number",
    "block_2": "block_2_title",
    "block_3": "block_3_subtitle",
    "block_4": "block_4_authority",
    "block_5": "block_5_contract_reference",
    "block_6": "block_6_requiring_office",
    "block_7": "block_7_dd250_requirement",
    "block_8": "block_8_approval_code",
    "block_9": "block_9_distribution_statement",
    "block_10": "block_10_frequency",
    "block_11": "block_11_as_of_date",
    "block_12": "block_12_first_submission",
    "block_13": "block_13_subsequent_submission",
    "block_14": "block_14_distribution",
    "block_15": "block_15_total",
    "block_16": "block_16_remarks",
    "block_17": "block_17_price_group",
    "block_18": "block_18_estimated_total_price",
}


def cdrl_response(cdrl: CDRL) -> CDRLResponse:
    values: dict[str, object] = {
        "id": cdrl.id,
        "project_id": cdrl.project_id,
        "document_id": cdrl.document_id,
        "document_name": cdrl.document.name,
        "requirement_id": cdrl.requirement_id,
        "fingerprint": cdrl.fingerprint,
        "source_text": cdrl.source_text,
        "source_start": cdrl.source_start,
        "source_end": cdrl.source_end,
        "source_locator": cdrl.source_locator,
        "extraction_method": cdrl.extraction_method,
        "rule_version": cdrl.rule_version,
        "incomplete": cdrl.incomplete,
        "incomplete_fields": cdrl.missing_fields,
        "source_truncated": cdrl.source_truncated,
        "validation_status": cdrl.validation_status,
        "reviewer": cdrl.reviewer,
        "reviewed_at": cdrl.reviewed_at,
        "created_at": cdrl.created_at,
        "updated_at": cdrl.updated_at,
    }
    values.update(
        {
            response_name: getattr(cdrl, model_name)
            for response_name, model_name in _CDRL_BLOCK_MAP.items()
        }
    )
    return CDRLResponse.model_validate(values)
