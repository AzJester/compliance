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


class WorkflowStage(StrEnum):
    PROJECT_SETUP = "PROJECT_SETUP"
    SOLICITATION_FILES = "SOLICITATION_FILES"
    VERIFY_PACKAGE = "VERIFY_PACKAGE"
    REQUIREMENTS = "REQUIREMENTS"
    PROPOSAL_RESPONSE = "PROPOSAL_RESPONSE"
    CROSSWALK = "CROSSWALK"
    REPORTS = "REPORTS"


class WorkflowStatus(StrEnum):
    NOT_STARTED = "NOT_STARTED"
    IN_PROGRESS = "IN_PROGRESS"
    BLOCKED = "BLOCKED"
    COMPLETE = "COMPLETE"


class DocumentClassification(StrEnum):
    UNCLASSIFIED = "UNCLASSIFIED"
    BASE_SOLICITATION = "BASE_SOLICITATION"
    AMENDMENT = "AMENDMENT"
    ATTACHMENT = "ATTACHMENT"
    CDRL = "CDRL"
    Q_AND_A = "Q_AND_A"
    REFERENCE = "REFERENCE"
    PROPOSAL_VOLUME = "PROPOSAL_VOLUME"


SOLICITATION_DOCUMENT_CLASSIFICATIONS = frozenset(
    {
        DocumentClassification.BASE_SOLICITATION,
        DocumentClassification.AMENDMENT,
        DocumentClassification.ATTACHMENT,
        DocumentClassification.CDRL,
        DocumentClassification.Q_AND_A,
    }
)


class IntakeVerificationStatus(StrEnum):
    PENDING = "PENDING"
    VERIFIED = "VERIFIED"
    ISSUE = "ISSUE"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class CrosswalkStatus(StrEnum):
    COVERED = "COVERED"
    PARTIAL = "PARTIAL"
    MISSING = "MISSING"
    CONFLICT = "CONFLICT"
    N_A = "N_A"


class ActionStatus(StrEnum):
    TODO = "TODO"
    IN_PROGRESS = "IN_PROGRESS"
    BLOCKED = "BLOCKED"
    DONE = "DONE"


class CDRLAdjudicationStatus(StrEnum):
    PENDING = "PENDING"
    REVIEWED = "REVIEWED"
    WAIVED = "WAIVED"


class SolicitationField(StrEnum):
    TITLE = "title"
    SOLICITATION_NUMBER = "solicitation_number"
    AGENCY = "agency"
    DUE_AT = "due_at"
    NAICS_CODE = "naics_code"
    PSC_CODE = "psc_code"
    SET_ASIDE = "set_aside"
    CONTRACT_TYPE = "contract_type"
    POINTS_OF_CONTACT = "points_of_contact"


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
    workflow: Mapped[ProjectWorkflow | None] = relationship(
        back_populates="project", cascade="all, delete-orphan", uselist=False
    )
    solicitation_profile: Mapped[SolicitationProfile | None] = relationship(
        back_populates="project", cascade="all, delete-orphan", uselist=False
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
    workflow_profile: Mapped[DocumentProfile | None] = relationship(
        back_populates="document", cascade="all, delete-orphan", uselist=False
    )

    @property
    def sha256(self) -> str:
        return self.blob_sha256

    @property
    def size_bytes(self) -> int:
        return self.blob.size_bytes

    @property
    def classification(self) -> DocumentClassification:
        if self.workflow_profile is None:
            return DocumentClassification.UNCLASSIFIED
        return self.workflow_profile.classification

    @property
    def volume_name(self) -> str | None:
        return self.workflow_profile.volume_name if self.workflow_profile is not None else None

    @property
    def classification_notes(self) -> str | None:
        return self.workflow_profile.notes if self.workflow_profile is not None else None


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
    adjudication: Mapped[CDRLAdjudication | None] = relationship(
        back_populates="cdrl", cascade="all, delete-orphan", uselist=False
    )

    __table_args__ = (
        UniqueConstraint("project_id", "fingerprint", name="uq_cdrl_project_fingerprint"),
        CheckConstraint("source_start >= 0", name="ck_cdrl_source_start"),
        CheckConstraint("source_end > source_start", name="ck_cdrl_source_end"),
        Index("ix_cdrl_project_validation", "project_id", "validation_status"),
    )


class CDRLAdjudication(Base):
    __tablename__ = "cdrl_adjudications"

    cdrl_id: Mapped[str] = mapped_column(
        ForeignKey("cdrls.id", ondelete="CASCADE"), primary_key=True
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[CDRLAdjudicationStatus] = mapped_column(
        Enum(CDRLAdjudicationStatus, native_enum=False),
        default=CDRLAdjudicationStatus.PENDING,
        index=True,
    )
    reviewer: Mapped[str | None] = mapped_column(String(150), nullable=True)
    waiver_reason: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    source_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, onupdate=utc_now)

    cdrl: Mapped[CDRL] = relationship(back_populates="adjudication")

    __table_args__ = (Index("ix_cdrl_adjudication_project_status", "project_id", "status"),)


class ProjectWorkflow(Base):
    __tablename__ = "project_workflows"

    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    stage: Mapped[WorkflowStage] = mapped_column(
        Enum(WorkflowStage, native_enum=False), default=WorkflowStage.PROJECT_SETUP
    )
    status: Mapped[WorkflowStatus] = mapped_column(
        Enum(WorkflowStatus, native_enum=False), default=WorkflowStatus.IN_PROGRESS
    )
    blocker_summary: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, onupdate=utc_now)

    project: Mapped[Project] = relationship(back_populates="workflow")


class DocumentProfile(Base):
    __tablename__ = "document_profiles"

    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    classification: Mapped[DocumentClassification] = mapped_column(
        Enum(DocumentClassification, native_enum=False),
        default=DocumentClassification.UNCLASSIFIED,
        index=True,
    )
    volume_name: Mapped[str | None] = mapped_column(String(250), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, onupdate=utc_now)

    document: Mapped[Document] = relationship(back_populates="workflow_profile")

    __table_args__ = (Index("ix_document_profile_project_class", "project_id", "classification"),)


class SolicitationProfile(Base):
    """Approved extended solicitation metadata that does not fit the legacy project row."""

    __tablename__ = "solicitation_profiles"

    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    issuing_office: Mapped[str | None] = mapped_column(String(500), nullable=True)
    naics_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    psc_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    set_aside: Mapped[str | None] = mapped_column(String(500), nullable=True)
    contract_type: Mapped[str | None] = mapped_column(String(500), nullable=True)
    points_of_contact: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON, default=list, server_default="[]"
    )
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, onupdate=utc_now)

    project: Mapped[Project] = relationship(back_populates="solicitation_profile")


class SolicitationAnalysisRun(Base):
    """Immutable evidence-backed metadata analysis for one exact input set."""

    __tablename__ = "solicitation_analysis_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    input_fingerprint: Mapped[str] = mapped_column(String(64))
    rule_version: Mapped[str] = mapped_column(String(50))
    analyzed_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)

    candidates: Mapped[list[SolicitationCandidate]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
    decisions: Mapped[list[SolicitationDecision]] = relationship(back_populates="run")

    __table_args__ = (
        UniqueConstraint(
            "project_id", "input_fingerprint", name="uq_solicitation_run_project_input"
        ),
        Index("ix_solicitation_run_project_analyzed", "project_id", "analyzed_at", "id"),
    )


class SolicitationCandidate(Base):
    """A normalized value tied to an exact, immutable source-text range."""

    __tablename__ = "solicitation_candidates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(
        ForeignKey("solicitation_analysis_runs.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    field_key: Mapped[SolicitationField] = mapped_column(
        Enum(SolicitationField, native_enum=False), index=True
    )
    value: Mapped[str] = mapped_column(String(4_000))
    normalized_value: Mapped[dict[str, Any]] = mapped_column(JSON)
    document_name: Mapped[str] = mapped_column(String(500))
    document_sha256: Mapped[str] = mapped_column(String(64))
    document_text_sha256: Mapped[str] = mapped_column(String(64))
    document_classification: Mapped[DocumentClassification] = mapped_column(
        Enum(DocumentClassification, native_enum=False)
    )
    is_amendment: Mapped[bool] = mapped_column(Boolean, default=False)
    amendment_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    explicit_change: Mapped[bool] = mapped_column(Boolean, default=False)
    source_start: Mapped[int] = mapped_column(Integer)
    source_end: Mapped[int] = mapped_column(Integer)
    source_locator: Mapped[str] = mapped_column(String(2_500))
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    excerpt: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float] = mapped_column(Float)
    confidence_level: Mapped[str] = mapped_column(String(10))
    detection_rationale: Mapped[str] = mapped_column(String(1_000))
    detection_pattern: Mapped[str] = mapped_column(String(150))
    applicable: Mapped[bool] = mapped_column(Boolean, default=True)
    needs_input: Mapped[str | None] = mapped_column(String(500), nullable=True)
    candidate_fingerprint: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)

    run: Mapped[SolicitationAnalysisRun] = relationship(back_populates="candidates")
    document: Mapped[Document] = relationship()
    decisions: Mapped[list[SolicitationDecision]] = relationship(back_populates="candidate")

    __table_args__ = (
        UniqueConstraint("run_id", "candidate_fingerprint", name="uq_candidate_run_fingerprint"),
        CheckConstraint("source_start >= 0", name="ck_solicitation_candidate_source_start"),
        CheckConstraint("source_end > source_start", name="ck_solicitation_candidate_source_end"),
        CheckConstraint(
            "confidence >= 0.0 AND confidence <= 1.0",
            name="ck_solicitation_candidate_confidence",
        ),
        Index("ix_solicitation_candidate_run_field", "run_id", "field_key", "id"),
    )


class SolicitationDecision(Base):
    """Audit record for each approved candidate application."""

    __tablename__ = "solicitation_decisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    run_id: Mapped[str] = mapped_column(
        ForeignKey("solicitation_analysis_runs.id", ondelete="RESTRICT"), index=True
    )
    candidate_id: Mapped[str] = mapped_column(
        ForeignKey("solicitation_candidates.id", ondelete="RESTRICT"), index=True
    )
    field_key: Mapped[SolicitationField] = mapped_column(
        Enum(SolicitationField, native_enum=False), index=True
    )
    reviewer: Mapped[str] = mapped_column(String(150))
    previous_value: Mapped[Any] = mapped_column(JSON, nullable=True)
    applied_value: Mapped[Any] = mapped_column(JSON, nullable=True)
    applied_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)

    run: Mapped[SolicitationAnalysisRun] = relationship(back_populates="decisions")
    candidate: Mapped[SolicitationCandidate] = relationship(back_populates="decisions")

    __table_args__ = (
        Index("ix_solicitation_decision_project_applied", "project_id", "applied_at", "id"),
    )


class IntakeVerification(Base):
    __tablename__ = "intake_verifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    document_id: Mapped[str | None] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=True, index=True
    )
    scope: Mapped[str] = mapped_column(String(36))
    check_key: Mapped[str] = mapped_column(String(100))
    label: Mapped[str] = mapped_column(String(250))
    status: Mapped[IntakeVerificationStatus] = mapped_column(
        Enum(IntakeVerificationStatus, native_enum=False),
        default=IntakeVerificationStatus.PENDING,
        index=True,
    )
    reviewer: Mapped[str | None] = mapped_column(String(150), nullable=True)
    note: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, onupdate=utc_now)

    document: Mapped[Document | None] = relationship()

    __table_args__ = (
        UniqueConstraint("project_id", "scope", "check_key", name="uq_intake_project_scope_key"),
        Index("ix_intake_project_status", "project_id", "status"),
    )


class CrosswalkFinding(Base):
    __tablename__ = "crosswalk_findings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    requirement_id: Mapped[str] = mapped_column(
        ForeignKey("requirements.id", ondelete="CASCADE"), unique=True, index=True
    )
    candidate_status: Mapped[CrosswalkStatus] = mapped_column(
        Enum(CrosswalkStatus, native_enum=False), index=True
    )
    status: Mapped[CrosswalkStatus] = mapped_column(
        Enum(CrosswalkStatus, native_enum=False), index=True
    )
    score: Mapped[float] = mapped_column(Float, default=0.0)
    candidate_signature: Mapped[str] = mapped_column(String(64))
    human_verified: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    reviewer: Mapped[str | None] = mapped_column(String(150), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    owner: Mapped[str | None] = mapped_column(String(150), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(4_000), nullable=True)
    stale: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    generated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, onupdate=utc_now)

    requirement: Mapped[Requirement] = relationship()
    evidence: Mapped[list[ProposalEvidence]] = relationship(
        back_populates="finding", cascade="all, delete-orphan"
    )

    @property
    def requirement_text(self) -> str:
        return self.requirement.requirement_text

    @property
    def requirement_section(self) -> RequirementSection:
        return self.requirement.section

    __table_args__ = (
        CheckConstraint("score >= 0.0 AND score <= 1.0", name="ck_crosswalk_score"),
        Index(
            "ix_crosswalk_project_status_verified",
            "project_id",
            "status",
            "human_verified",
        ),
    )


class ProposalEvidence(Base):
    __tablename__ = "proposal_evidence"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    finding_id: Mapped[str] = mapped_column(
        ForeignKey("crosswalk_findings.id", ondelete="CASCADE"), index=True
    )
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    source_start: Mapped[int] = mapped_column(Integer)
    source_end: Mapped[int] = mapped_column(Integer)
    source_locator: Mapped[str] = mapped_column(String(2_500))
    excerpt: Mapped[str] = mapped_column(Text)
    score: Mapped[float] = mapped_column(Float)
    is_manual: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)

    finding: Mapped[CrosswalkFinding] = relationship(back_populates="evidence")
    document: Mapped[Document] = relationship()

    @property
    def document_name(self) -> str:
        return self.document.name

    __table_args__ = (
        CheckConstraint("source_start >= 0", name="ck_evidence_source_start"),
        CheckConstraint("source_end > source_start", name="ck_evidence_source_end"),
        CheckConstraint("score >= 0.0 AND score <= 1.0", name="ck_evidence_score"),
        Index("ix_evidence_finding_source", "finding_id", "source_start", "id"),
    )


class ProjectAction(Base):
    __tablename__ = "project_actions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(250))
    description: Mapped[str | None] = mapped_column(String(4_000), nullable=True)
    status: Mapped[ActionStatus] = mapped_column(
        Enum(ActionStatus, native_enum=False), default=ActionStatus.TODO, index=True
    )
    owner: Mapped[str | None] = mapped_column(String(150), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    requirement_id: Mapped[str | None] = mapped_column(
        ForeignKey("requirements.id", ondelete="SET NULL"), nullable=True
    )
    finding_id: Mapped[str | None] = mapped_column(
        ForeignKey("crosswalk_findings.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, onupdate=utc_now)

    __table_args__ = (Index("ix_action_project_status_due", "project_id", "status", "due_at"),)


class RequirementExtractionState(Base):
    """Records the exact document state covered by the latest requirements run."""

    __tablename__ = "requirement_extraction_states"

    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    blob_sha256: Mapped[str] = mapped_column(String(64))
    text_sha256: Mapped[str] = mapped_column(String(64))
    classification: Mapped[DocumentClassification] = mapped_column(
        Enum(DocumentClassification, native_enum=False)
    )
    rule_version: Mapped[str] = mapped_column(String(50))
    analyzed_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)

    __table_args__ = (
        Index("ix_requirement_extraction_state_project", "project_id", "document_id"),
    )


class CrosswalkRunState(Base):
    """Pins a crosswalk run to its requirement and proposal input sets."""

    __tablename__ = "crosswalk_run_states"

    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    requirement_signature: Mapped[str] = mapped_column(String(64))
    proposal_signature: Mapped[str] = mapped_column(String(64))
    generated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)
