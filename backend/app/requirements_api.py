from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from .config import Settings
from .database import get_session
from .models import (
    CDRL,
    SOLICITATION_DOCUMENT_CLASSIFICATIONS,
    Document,
    DocumentProfile,
    Project,
    Requirement,
    RequirementCategory,
    RequirementSection,
    ReviewDecision,
    ValidationStatus,
)
from .requirements_rules import ExtractionLimitError
from .requirements_service import (
    StaleRequirementError,
    apply_requirement_patch,
    cdrl_response,
    extract_project_register,
)
from .schemas import (
    CDRLResponse,
    ExtractionSummary,
    RequirementPatch,
    RequirementResponse,
    ReviewDecisionResponse,
)

router = APIRouter(prefix="/api/projects/{project_id}", tags=["requirements"])


def _project(session: Session, project_id: str) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


def _requirement(session: Session, project_id: str, requirement_id: str) -> Requirement:
    requirement = session.scalar(
        select(Requirement)
        .join(Document, Document.id == Requirement.document_id)
        .outerjoin(DocumentProfile, DocumentProfile.document_id == Document.id)
        .options(selectinload(Requirement.document), selectinload(Requirement.cdrl))
        .where(
            Requirement.id == requirement_id,
            Requirement.project_id == project_id,
            or_(
                DocumentProfile.document_id.is_(None),
                DocumentProfile.classification.in_(SOLICITATION_DOCUMENT_CLASSIFICATIONS),
            ),
        )
    )
    if requirement is None:
        raise HTTPException(status_code=404, detail="Requirement not found.")
    return requirement


@router.post("/requirements/extract", response_model=ExtractionSummary)
def extract_requirements(
    project_id: str,
    request: Request,
    session: Session = Depends(get_session),
) -> ExtractionSummary:
    settings: Settings = request.app.state.settings
    for attempt in range(2):
        try:
            project = _project(session, project_id)
            summary = extract_project_register(session, project, settings)
            session.commit()
            return summary
        except ExtractionLimitError as exc:
            session.rollback()
            raise HTTPException(status_code=413, detail=str(exc)) from None
        except IntegrityError:
            session.rollback()
            if attempt == 0:
                continue
            raise
        except Exception:
            session.rollback()
            raise
    raise RuntimeError("Extraction retry loop exhausted")


@router.get("/requirements", response_model=list[RequirementResponse])
def list_requirements(
    project_id: str,
    section: RequirementSection | None = Query(default=None),
    category: RequirementCategory | None = Query(default=None),
    validation_status: ValidationStatus | None = Query(default=None),
    document_id: str | None = Query(default=None),
    session: Session = Depends(get_session),
) -> list[Requirement]:
    _project(session, project_id)
    if document_id is not None:
        document = session.scalar(
            select(Document).where(
                Document.id == document_id,
                Document.project_id == project_id,
            )
        )
        if document is None:
            raise HTTPException(status_code=404, detail="Document not found.")

    statement = (
        select(Requirement)
        .join(Document, Document.id == Requirement.document_id)
        .outerjoin(DocumentProfile, DocumentProfile.document_id == Document.id)
        .options(selectinload(Requirement.document))
        .where(
            Requirement.project_id == project_id,
            or_(
                DocumentProfile.document_id.is_(None),
                DocumentProfile.classification.in_(SOLICITATION_DOCUMENT_CLASSIFICATIONS),
            ),
        )
    )
    if section is not None:
        statement = statement.where(Requirement.section == section)
    if category is not None:
        statement = statement.where(Requirement.category == category)
    if validation_status is not None:
        statement = statement.where(Requirement.validation_status == validation_status)
    if document_id is not None:
        statement = statement.where(Requirement.document_id == document_id)
    return list(
        session.scalars(
            statement.order_by(
                Requirement.document_id,
                Requirement.source_start,
                Requirement.fingerprint,
            )
        )
    )


@router.patch("/requirements/{requirement_id}", response_model=RequirementResponse)
def patch_requirement(
    project_id: str,
    requirement_id: str,
    patch: RequirementPatch,
    session: Session = Depends(get_session),
) -> Requirement:
    _project(session, project_id)
    requirement = _requirement(session, project_id, requirement_id)
    try:
        apply_requirement_patch(session, requirement, patch)
        session.commit()
        session.refresh(requirement)
        return requirement
    except StaleRequirementError as exc:
        session.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except ValueError as exc:
        session.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from None


@router.get(
    "/requirements/{requirement_id}/reviews",
    response_model=list[ReviewDecisionResponse],
)
def list_requirement_reviews(
    project_id: str,
    requirement_id: str,
    session: Session = Depends(get_session),
) -> list[ReviewDecision]:
    _project(session, project_id)
    _requirement(session, project_id, requirement_id)
    return list(
        session.scalars(
            select(ReviewDecision)
            .where(
                ReviewDecision.project_id == project_id,
                ReviewDecision.requirement_id == requirement_id,
            )
            .order_by(ReviewDecision.created_at, ReviewDecision.id)
        )
    )


@router.get("/cdrls", response_model=list[CDRLResponse])
def list_cdrls(project_id: str, session: Session = Depends(get_session)) -> list[CDRLResponse]:
    _project(session, project_id)
    cdrls = session.scalars(
        select(CDRL)
        .join(Document, Document.id == CDRL.document_id)
        .outerjoin(DocumentProfile, DocumentProfile.document_id == Document.id)
        .options(selectinload(CDRL.document), selectinload(CDRL.requirement))
        .where(
            CDRL.project_id == project_id,
            or_(
                DocumentProfile.document_id.is_(None),
                DocumentProfile.classification.in_(SOLICITATION_DOCUMENT_CLASSIFICATIONS),
            ),
        )
        .order_by(CDRL.document_id, CDRL.source_start, CDRL.fingerprint)
    )
    return [cdrl_response(cdrl) for cdrl in cdrls]
