from __future__ import annotations

from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from .models import (
    CrosswalkFinding,
    IntakeVerification,
    IntakeVerificationStatus,
    RequirementExtractionState,
    utc_now,
)


def reset_package_verification(session: Session, project_id: str) -> None:
    """Require a fresh package review after the solicitation inventory changes."""

    session.execute(
        update(IntakeVerification)
        .where(IntakeVerification.project_id == project_id)
        .values(
            status=IntakeVerificationStatus.PENDING,
            reviewer=None,
            updated_at=utc_now(),
        )
    )


def mark_crosswalk_stale(
    session: Session,
    project_id: str,
    *,
    requirement_id: str | None = None,
) -> None:
    """Preserve decisions while forcing changed analysis inputs through review again."""

    statement = update(CrosswalkFinding).where(CrosswalkFinding.project_id == project_id)
    if requirement_id is not None:
        statement = statement.where(CrosswalkFinding.requirement_id == requirement_id)
    session.execute(statement.values(stale=True, updated_at=utc_now()))


def invalidate_requirement_extraction(session: Session, document_id: str) -> None:
    session.execute(
        delete(RequirementExtractionState).where(
            RequirementExtractionState.document_id == document_id
        )
    )
