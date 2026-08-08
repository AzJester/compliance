from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator


def utc_now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class UTCDateTime(TypeDecorator[datetime]):
    """Persist aware datetimes as naive UTC and always restore an aware UTC value."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: object) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("UTCDateTime requires a timezone-aware value")
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect: object) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is not None and value.utcoffset() is not None:
            return value.astimezone(UTC)
        return value.replace(tzinfo=UTC)


class Sensitivity(StrEnum):
    PUBLIC = "PUBLIC"
    CUI = "CUI"
    ITAR = "ITAR"


class DocumentStatus(StrEnum):
    EXTRACTED = "EXTRACTED"
    NEEDS_OCR = "NEEDS_OCR"
    ARCHIVE_EXPANDED = "ARCHIVE_EXPANDED"
    ERROR = "ERROR"


class RequirementSection(StrEnum):
    A = "A"
    B = "B"
    C = "C"
    D = "D"
    E = "E"
    F = "F"
    G = "G"
    H = "H"
    I = "I"  # noqa: E741 - FAR uniform contract Section I
    J = "J"
    K = "K"
    L = "L"
    M = "M"
    UNKNOWN = "UNKNOWN"


class RequirementCategory(StrEnum):
    GENERAL = "GENERAL"
    SUBMISSION_INSTRUCTION = "SUBMISSION_INSTRUCTION"
    EVALUATION_FACTOR = "EVALUATION_FACTOR"
    CDRL = "CDRL"
    CLAUSE = "CLAUSE"
    DELIVERABLE = "DELIVERABLE"
    SCHEDULE = "SCHEDULE"
    STAFFING = "STAFFING"
    SECURITY = "SECURITY"
    DATA_RIGHTS = "DATA_RIGHTS"
    PRICING = "PRICING"
    REPRESENTATION = "REPRESENTATION"


class ObligationOwner(StrEnum):
    OFFEROR = "OFFEROR"
    CONTRACTOR = "CONTRACTOR"
    SUBCONTRACTOR = "SUBCONTRACTOR"
    GOVERNMENT = "GOVERNMENT"
    INFORMATIONAL = "INFORMATIONAL"


class RequirementApplicability(StrEnum):
    SOLICITATION = "SOLICITATION"
    PROPOSAL = "PROPOSAL"
    POST_AWARD = "POST_AWARD"
    INFORMATIONAL = "INFORMATIONAL"


class ValidationStatus(StrEnum):
    PENDING = "PENDING"
    VALIDATED = "VALIDATED"
    DISMISSED = "DISMISSED"


class ReviewAction(StrEnum):
    UPDATED = "UPDATED"
    VALIDATED = "VALIDATED"
    DISMISSED = "DISMISSED"
    REOPENED = "REOPENED"


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(250))
    solicitation_number: Mapped[str | None] = mapped_column(String(150), nullable=True)
    agency: Mapped[str | None] = mapped_column(String(250), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    due_timezone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sensitivity: Mapped[Sensitivity] = mapped_column(
        Enum(Sensitivity, native_enum=False), default=Sensitivity.PUBLIC
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, onupdate=utc_now)

    documents: Mapped[list[Document]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    requirements: Mapped[list[Requirement]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    cdrls: Mapped[list[CDRL]] = relationship(back_populates="project", cascade="all, delete-orphan")
    review_decisions: Mapped[list[ReviewDecision]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class Blob(Base):
    __tablename__ = "blobs"

    sha256: Mapped[str] = mapped_column(String(64), primary_key=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    storage_path: Mapped[str] = mapped_column(String(2_000))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)

    documents: Mapped[list[Document]] = relationship(back_populates="blob")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    blob_sha256: Mapped[str] = mapped_column(ForeignKey("blobs.sha256"), index=True)
    name: Mapped[str] = mapped_column(String(500))
    relative_path: Mapped[str] = mapped_column(String(2_000))
    content_type: Mapped[str] = mapped_column(String(200))
    source_archive: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    status: Mapped[DocumentStatus] = mapped_column(Enum(DocumentStatus, native_enum=False))
    extraction_count: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    extracted_text: Mapped[str] = mapped_column(Text, default="")
    duplicate_of: Mapped[str | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)

    project: Mapped[Project] = relationship(back_populates="documents")
    blob: Mapped[Blob] = relationship(back_populates="documents")
    requirements: Mapped[list[Requirement]] = relationship(back_populates="document")
    cdrls: Mapped[list[CDRL]] = relationship(back_populates="document")

    @property
    def sha256(self) -> str:
        return self.blob_sha256

    @property
    def size_bytes(self) -> int:
        return self.blob.size_bytes


class Requirement(Base):
    __tablename__ = "requirements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    fingerprint: Mapped[str] = mapped_column(String(64))
    source_text: Mapped[str] = mapped_column(Text)
    source_start: Mapped[int] = mapped_column(Integer)
    source_end: Mapped[int] = mapped_column(Integer)
    source_locator: Mapped[str] = mapped_column(String(2_500))
    requirement_text: Mapped[str] = mapped_column(String(8_000))
    section: Mapped[RequirementSection] = mapped_column(
        Enum(RequirementSection, native_enum=False), index=True
    )
    category: Mapped[RequirementCategory] = mapped_column(
        Enum(RequirementCategory, native_enum=False), index=True
    )
    mandatory_term: Mapped[str | None] = mapped_column(String(50), nullable=True)
    obligation_owner: Mapped[ObligationOwner] = mapped_column(
        Enum(ObligationOwner, native_enum=False)
    )
    applicability: Mapped[RequirementApplicability] = mapped_column(
        Enum(RequirementApplicability, native_enum=False)
    )
    confidence: Mapped[float] = mapped_column(Float)
    extraction_method: Mapped[str] = mapped_column(String(100))
    rule_version: Mapped[str] = mapped_column(String(50))
    validation_status: Mapped[ValidationStatus] = mapped_column(
        Enum(ValidationStatus, native_enum=False),
        default=ValidationStatus.PENDING,
        index=True,
    )
    reviewer: Mapped[str | None] = mapped_column(String(150), nullable=True)
    review_note: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    dismissal_reason: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, onupdate=utc_now)

    project: Mapped[Project] = relationship(back_populates="requirements")
    document: Mapped[Document] = relationship(back_populates="requirements")
    reviews: Mapped[list[ReviewDecision]] = relationship(
        back_populates="requirement", cascade="all, delete-orphan"
    )
    cdrl: Mapped[CDRL | None] = relationship(back_populates="requirement", uselist=False)

    @property
    def document_name(self) -> str:
        return self.document.name

    __table_args__ = (
        UniqueConstraint("project_id", "fingerprint", name="uq_requirement_project_fingerprint"),
        CheckConstraint("source_start >= 0", name="ck_requirement_source_start"),
        CheckConstraint("source_end > source_start", name="ck_requirement_source_end"),
        CheckConstraint(
            "confidence >= 0.0 AND confidence <= 1.0",
            name="ck_requirement_confidence",
        ),
        Index(
            "ix_requirement_project_filters",
            "project_id",
            "section",
            "category",
            "validation_status",
        ),
    )


class ReviewDecision(Base):
    __tablename__ = "review_decisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    requirement_id: Mapped[str] = mapped_column(
        ForeignKey("requirements.id", ondelete="CASCADE"), index=True
    )
    reviewer: Mapped[str] = mapped_column(String(150), nullable=False)
    action: Mapped[ReviewAction] = mapped_column(Enum(ReviewAction, native_enum=False))
    previous_state: Mapped[dict[str, Any]] = mapped_column(JSON)
    new_state: Mapped[dict[str, Any]] = mapped_column(JSON)
    note: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)

    project: Mapped[Project] = relationship(back_populates="review_decisions")
    requirement: Mapped[Requirement] = relationship(back_populates="reviews")

    __table_args__ = (Index("ix_review_requirement_created", "requirement_id", "created_at", "id"),)


class CDRL(Base):
    __tablename__ = "cdrls"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    requirement_id: Mapped[str] = mapped_column(
        ForeignKey("requirements.id", ondelete="CASCADE"), unique=True
    )
    fingerprint: Mapped[str] = mapped_column(String(64))
    source_text: Mapped[str] = mapped_column(Text)
    source_start: Mapped[int] = mapped_column(Integer)
    source_end: Mapped[int] = mapped_column(Integer)
    source_locator: Mapped[str] = mapped_column(String(2_500))
    extraction_method: Mapped[str] = mapped_column(String(100))
    rule_version: Mapped[str] = mapped_column(String(50))
    incomplete: Mapped[bool] = mapped_column(Boolean, default=True)
    missing_fields: Mapped[list[str]] = mapped_column(JSON, default=list)
    source_truncated: Mapped[bool] = mapped_column(Boolean, default=False)
    validation_status: Mapped[ValidationStatus] = mapped_column(
        Enum(ValidationStatus, native_enum=False), default=ValidationStatus.PENDING
    )
    reviewer: Mapped[str | None] = mapped_column(String(150), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)

    block_a_contract_line_item_number: Mapped[str | None] = mapped_column(
        String(1_000), nullable=True
    )
    block_b_exhibit: Mapped[str | None] = mapped_column(String(1_000), nullable=True)
    block_c_category: Mapped[str | None] = mapped_column(String(1_000), nullable=True)
    block_d_system_item: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    block_e_contract_pr_number: Mapped[str | None] = mapped_column(String(1_000), nullable=True)
    block_f_contractor: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    block_1_data_item_number: Mapped[str | None] = mapped_column(String(1_000), nullable=True)
    block_2_title: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    block_3_subtitle: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    block_4_authority: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    block_5_contract_reference: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    block_6_requiring_office: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    block_7_dd250_requirement: Mapped[str | None] = mapped_column(String(1_000), nullable=True)
    block_8_approval_code: Mapped[str | None] = mapped_column(String(1_000), nullable=True)
    block_9_distribution_statement: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    block_10_frequency: Mapped[str | None] = mapped_column(String(1_000), nullable=True)
    block_11_as_of_date: Mapped[str | None] = mapped_column(String(1_000), nullable=True)
    block_12_first_submission: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    block_13_subsequent_submission: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    block_14_distribution: Mapped[str | None] = mapped_column(Text, nullable=True)
    block_15_total: Mapped[str | None] = mapped_column(String(1_000), nullable=True)
    block_16_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    block_17_price_group: Mapped[str | None] = mapped_column(String(1_000), nullable=True)
    block_18_estimated_total_price: Mapped[str | None] = mapped_column(String(1_000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, onupdate=utc_now)

    project: Mapped[Project] = relationship(back_populates="cdrls")
    document: Mapped[Document] = relationship(back_populates="cdrls")
    requirement: Mapped[Requirement] = relationship(back_populates="cdrl")

    __table_args__ = (
        UniqueConstraint("project_id", "fingerprint", name="uq_cdrl_project_fingerprint"),
        CheckConstraint("source_start >= 0", name="ck_cdrl_source_start"),
        CheckConstraint("source_end > source_start", name="ck_cdrl_source_end"),
        Index("ix_cdrl_project_validation", "project_id", "validation_status"),
    )
