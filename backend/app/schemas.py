from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .models import (
    ActionStatus,
    CDRLAdjudicationStatus,
    CrosswalkStatus,
    DocumentClassification,
    DocumentStatus,
    IntakeVerificationStatus,
    ObligationOwner,
    RequirementApplicability,
    RequirementCategory,
    RequirementSection,
    ReviewAction,
    Sensitivity,
    SolicitationField,
    ValidationStatus,
    WorkflowStage,
    WorkflowStatus,
)


class ProjectCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: str = Field(min_length=1, max_length=250)
    solicitation_number: str | None = Field(default=None, max_length=150)
    agency: str | None = Field(default=None, max_length=250)
    due_at: datetime | None = None
    due_timezone: str | None = Field(default=None, max_length=100)
    sensitivity: Sensitivity = Sensitivity.PUBLIC

    @field_validator("sensitivity")
    @classmethod
    def require_public_sensitivity(cls, value: Sensitivity) -> Sensitivity:
        if value != Sensitivity.PUBLIC:
            raise ValueError("Only PUBLIC projects are supported by this prototype")
        return value

    @field_validator("due_at")
    @classmethod
    def require_offset(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("due_at must include a UTC offset")
        return value

    @field_validator("due_timezone")
    @classmethod
    def validate_timezone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError:
            raise ValueError("due_timezone must be a valid IANA timezone") from None
        return value

    @model_validator(mode="after")
    def require_due_timezone(self) -> ProjectCreate:
        if self.due_at is not None and self.due_timezone is None:
            raise ValueError("due_timezone is required when due_at is provided")
        return self


class ProjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    solicitation_number: str | None
    agency: str | None
    due_at: datetime | None
    due_timezone: str | None
    sensitivity: Sensitivity
    created_at: datetime
    updated_at: datetime


class ProjectPatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=250)
    solicitation_number: str | None = Field(default=None, max_length=150)
    agency: str | None = Field(default=None, max_length=250)
    due_at: datetime | None = None
    due_timezone: str | None = Field(default=None, max_length=100)

    @field_validator("due_at")
    @classmethod
    def require_patch_offset(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("due_at must include a UTC offset")
        return value

    @field_validator("due_timezone")
    @classmethod
    def validate_patch_timezone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError:
            raise ValueError("due_timezone must be a valid IANA timezone") from None
        return value

    @model_validator(mode="after")
    def require_patch_field(self) -> ProjectPatch:
        if not self.model_fields_set:
            raise ValueError("At least one project field is required")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name cannot be null")
        return self


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    relative_path: str
    content_type: str
    size_bytes: int
    sha256: str
    status: DocumentStatus
    extraction_count: int
    source_archive: str | None
    duplicate_of: str | None
    error: str | None
    classification: DocumentClassification
    volume_name: str | None
    classification_notes: str | None
    created_at: datetime


class HealthResponse(BaseModel):
    status: str
    host: str
    telemetry: bool
    access_mode: Literal["local", "authenticated", "anonymous"]


class ExtractionSummary(BaseModel):
    documents_analyzed: int = Field(ge=0)
    requirements_created: int = Field(ge=0)
    requirements_reused: int = Field(ge=0)
    cdrls_created: int = Field(ge=0)
    cdrls_reused: int = Field(ge=0)
    total_requirements: int = Field(ge=0)
    pending_requirements: int = Field(ge=0)


class RequirementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    document_id: str
    document_name: str
    fingerprint: str
    source_text: str
    source_start: int
    source_end: int
    source_locator: str
    requirement_text: str
    section: RequirementSection
    category: RequirementCategory
    mandatory_term: str | None
    obligation_owner: ObligationOwner
    applicability: RequirementApplicability
    confidence: float
    extraction_method: str
    rule_version: str
    validation_status: ValidationStatus
    reviewer: str | None
    review_note: str | None
    dismissal_reason: str | None
    created_at: datetime
    updated_at: datetime


class RequirementPatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    requirement_text: str | None = Field(default=None, min_length=1, max_length=8_000)
    section: RequirementSection | None = None
    category: RequirementCategory | None = None
    obligation_owner: ObligationOwner | None = None
    applicability: RequirementApplicability | None = None
    validation_status: ValidationStatus | None = None
    reviewer: str = Field(min_length=1, max_length=150)
    review_note: str | None = Field(default=None, max_length=2_000)
    expected_updated_at: datetime

    @field_validator("expected_updated_at")
    @classmethod
    def require_expected_offset(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("expected_updated_at must include a UTC offset")
        return value

    @model_validator(mode="after")
    def validate_review(self) -> RequirementPatch:
        editable = {
            "requirement_text",
            "section",
            "category",
            "obligation_owner",
            "applicability",
            "validation_status",
        }
        if not self.model_fields_set.intersection(editable):
            raise ValueError("At least one editable field is required")
        null_fields = sorted(
            field
            for field in self.model_fields_set.intersection(editable)
            if getattr(self, field) is None
        )
        if null_fields:
            raise ValueError(f"Editable fields cannot be null: {', '.join(null_fields)}")
        if self.validation_status == ValidationStatus.DISMISSED and not self.review_note:
            raise ValueError("review_note is required to dismiss")
        return self


class ReviewDecisionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    requirement_id: str
    reviewer: str
    action: ReviewAction
    previous_state: dict[str, object]
    new_state: dict[str, object]
    note: str | None
    created_at: datetime


class CDRLResponse(BaseModel):
    id: str
    project_id: str
    document_id: str
    document_name: str
    requirement_id: str
    fingerprint: str
    source_text: str
    source_start: int
    source_end: int
    source_locator: str
    extraction_method: str
    rule_version: str
    incomplete: bool
    incomplete_fields: list[str]
    source_truncated: bool
    validation_status: ValidationStatus
    reviewer: str | None
    reviewed_at: datetime | None
    block_a: str | None = None
    block_b: str | None = None
    block_c: str | None = None
    block_d: str | None = None
    block_e: str | None = None
    block_f: str | None = None
    block_1: str | None = None
    block_2: str | None = None
    block_3: str | None = None
    block_4: str | None = None
    block_5: str | None = None
    block_6: str | None = None
    block_7: str | None = None
    block_8: str | None = None
    block_9: str | None = None
    block_10: str | None = None
    block_11: str | None = None
    block_12: str | None = None
    block_13: str | None = None
    block_14: str | None = None
    block_15: str | None = None
    block_16: str | None = None
    block_17: str | None = None
    block_18: str | None = None
    created_at: datetime
    updated_at: datetime


class CDRLAdjudicationPatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    status: CDRLAdjudicationStatus
    reviewer: str | None = Field(default=None, max_length=150)
    waiver_reason: str | None = Field(default=None, max_length=2_000)
    expected_updated_at: datetime | None = None

    @field_validator("expected_updated_at")
    @classmethod
    def require_cdrl_expected_offset(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("expected_updated_at must include a UTC offset")
        return value

    @model_validator(mode="after")
    def validate_adjudication(self) -> CDRLAdjudicationPatch:
        if (
            self.status
            in {
                CDRLAdjudicationStatus.REVIEWED,
                CDRLAdjudicationStatus.WAIVED,
            }
            and not self.reviewer
        ):
            raise ValueError("reviewer is required for CDRL adjudication")
        if self.status == CDRLAdjudicationStatus.WAIVED and not self.waiver_reason:
            raise ValueError("waiver_reason is required to waive a CDRL issue")
        return self


class CDRLAdjudicationResponse(BaseModel):
    cdrl_id: str
    project_id: str
    status: CDRLAdjudicationStatus
    reviewer: str | None
    waiver_reason: str | None
    reviewed_at: datetime | None
    updated_at: datetime | None
    source_fingerprint: str | None
    fresh: bool
    context_only: bool
    incomplete: bool
    missing_fields: list[str]
    effective_ready: bool


class WorkflowResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    project_id: str
    stage: WorkflowStage
    status: WorkflowStatus
    blocker_summary: str | None
    updated_at: datetime


class WorkflowPatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    stage: WorkflowStage | None = None
    status: WorkflowStatus | None = None
    blocker_summary: str | None = Field(default=None, max_length=2_000)

    @model_validator(mode="after")
    def validate_workflow_patch(self) -> WorkflowPatch:
        if not self.model_fields_set:
            raise ValueError("At least one workflow field is required")
        required = {"stage", "status"}.intersection(self.model_fields_set)
        null_fields = sorted(field for field in required if getattr(self, field) is None)
        if null_fields:
            raise ValueError(f"Workflow fields cannot be null: {', '.join(null_fields)}")
        if self.status == WorkflowStatus.BLOCKED and not self.blocker_summary:
            raise ValueError("blocker_summary is required when workflow status is BLOCKED")
        return self


class DocumentProfilePatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    classification: DocumentClassification
    volume_name: str | None = Field(default=None, max_length=250)
    classification_notes: str | None = Field(default=None, max_length=2_000)

    @model_validator(mode="after")
    def require_proposal_volume_name(self) -> DocumentProfilePatch:
        if self.classification == DocumentClassification.PROPOSAL_VOLUME and not self.volume_name:
            raise ValueError("volume_name is required for a proposal volume")
        return self


class DocumentTextResponse(BaseModel):
    document_id: str
    name: str
    total_characters: int = Field(ge=0)
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    text: str
    truncated: bool


class IntakeVerificationCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    document_id: str | None = Field(default=None, max_length=36)
    check_key: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]*$", min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=250)
    status: IntakeVerificationStatus = IntakeVerificationStatus.PENDING
    reviewer: str | None = Field(default=None, max_length=150)
    note: str | None = Field(default=None, max_length=2_000)


class IntakeVerificationPatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    label: str | None = Field(default=None, min_length=1, max_length=250)
    status: IntakeVerificationStatus | None = None
    reviewer: str | None = Field(default=None, max_length=150)
    note: str | None = Field(default=None, max_length=2_000)

    @model_validator(mode="after")
    def validate_intake_patch(self) -> IntakeVerificationPatch:
        if not self.model_fields_set:
            raise ValueError("At least one verification field is required")
        required = {"label", "status"}.intersection(self.model_fields_set)
        null_fields = sorted(field for field in required if getattr(self, field) is None)
        if null_fields:
            raise ValueError(f"Verification fields cannot be null: {', '.join(null_fields)}")
        return self


class IntakeVerificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    document_id: str | None
    check_key: str
    label: str
    status: IntakeVerificationStatus
    reviewer: str | None
    note: str | None
    created_at: datetime
    updated_at: datetime


class ProposalEvidenceCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    document_id: str = Field(min_length=1, max_length=36)
    source_start: int = Field(ge=0)
    source_end: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_evidence_range(self) -> ProposalEvidenceCreate:
        if self.source_end <= self.source_start:
            raise ValueError("source_end must be greater than source_start")
        if self.source_end - self.source_start > 8_000:
            raise ValueError("Manual evidence cannot exceed 8,000 characters")
        return self


class ProposalEvidenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    finding_id: str
    document_id: str
    document_name: str
    source_start: int
    source_end: int
    source_locator: str
    excerpt: str
    score: float
    is_manual: bool
    created_at: datetime


class CrosswalkFindingPatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    status: CrosswalkStatus | None = None
    human_verified: bool | None = None
    reviewer: str | None = Field(default=None, max_length=150)
    owner: str | None = Field(default=None, max_length=150)
    due_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=4_000)
    expected_updated_at: datetime | None = None

    @field_validator("due_at")
    @classmethod
    def require_finding_due_offset(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("due_at must include a UTC offset")
        return value

    @field_validator("expected_updated_at")
    @classmethod
    def require_finding_expected_offset(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("expected_updated_at must include a UTC offset")
        return value

    @model_validator(mode="after")
    def validate_finding_patch(self) -> CrosswalkFindingPatch:
        if not self.model_fields_set:
            raise ValueError("At least one crosswalk field is required")
        if "status" in self.model_fields_set and self.status is None:
            raise ValueError("status cannot be null")
        if self.human_verified is True and not self.reviewer:
            raise ValueError("reviewer is required for human verification")
        return self


class CrosswalkFindingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    requirement_id: str
    requirement_text: str
    requirement_section: RequirementSection
    candidate_status: CrosswalkStatus
    status: CrosswalkStatus
    score: float
    human_verified: bool
    reviewer: str | None
    reviewed_at: datetime | None
    owner: str | None
    due_at: datetime | None
    notes: str | None
    stale: bool
    generated_at: datetime
    updated_at: datetime
    evidence: list[ProposalEvidenceResponse]
    needs_attention: bool = False
    attention_reasons: list[str] = Field(default_factory=list)


class CrosswalkGenerateSummary(BaseModel):
    requirements_analyzed: int = Field(ge=0)
    proposal_documents_analyzed: int = Field(ge=0)
    findings_created: int = Field(ge=0)
    findings_updated: int = Field(ge=0)
    verified_findings_marked_stale: int = Field(ge=0)


class ProjectActionCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    title: str = Field(min_length=1, max_length=250)
    description: str | None = Field(default=None, max_length=4_000)
    status: ActionStatus = ActionStatus.TODO
    owner: str | None = Field(default=None, max_length=150)
    due_at: datetime | None = None
    requirement_id: str | None = Field(default=None, max_length=36)
    finding_id: str | None = Field(default=None, max_length=36)

    @field_validator("due_at")
    @classmethod
    def require_action_due_offset(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("due_at must include a UTC offset")
        return value


class ProjectActionPatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=250)
    description: str | None = Field(default=None, max_length=4_000)
    status: ActionStatus | None = None
    owner: str | None = Field(default=None, max_length=150)
    due_at: datetime | None = None

    @field_validator("due_at")
    @classmethod
    def require_action_patch_due_offset(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("due_at must include a UTC offset")
        return value

    @model_validator(mode="after")
    def validate_action_patch(self) -> ProjectActionPatch:
        if not self.model_fields_set:
            raise ValueError("At least one action field is required")
        required = {"title", "status"}.intersection(self.model_fields_set)
        null_fields = sorted(field for field in required if getattr(self, field) is None)
        if null_fields:
            raise ValueError(f"Action fields cannot be null: {', '.join(null_fields)}")
        return self


class ProjectActionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    title: str
    description: str | None
    status: ActionStatus
    owner: str | None
    due_at: datetime | None
    requirement_id: str | None
    finding_id: str | None
    created_at: datetime
    updated_at: datetime


class StageProgressResponse(BaseModel):
    stage: WorkflowStage
    label: str
    status: WorkflowStatus
    completed_items: int = Field(ge=0)
    total_items: int = Field(ge=0)
    blocking_reasons: list[str]
    next_action: str | None


class ReadinessResponse(BaseModel):
    project_id: str
    ready: bool
    readiness_percent: float = Field(ge=0, le=100)
    workflow_stage: WorkflowStage
    workflow_status: WorkflowStatus
    documents_total: int = Field(ge=0)
    documents_classified: int = Field(ge=0)
    proposal_documents: int = Field(ge=0)
    intake_total: int = Field(ge=0)
    intake_verified: int = Field(ge=0)
    intake_issues: int = Field(ge=0)
    requirements_total: int = Field(ge=0)
    requirements_validated: int = Field(ge=0)
    requirements_pending: int = Field(ge=0)
    cdrls_total: int = Field(ge=0)
    cdrls_ready: int = Field(ge=0)
    cdrls_incomplete: int = Field(ge=0)
    cdrls_unreviewed: int = Field(ge=0)
    cdrls_waived: int = Field(ge=0)
    cdrls_stale: int = Field(ge=0)
    crosswalk_total: int = Field(ge=0)
    crosswalk_verified: int = Field(ge=0)
    covered: int = Field(ge=0)
    partial: int = Field(ge=0)
    missing: int = Field(ge=0)
    conflict: int = Field(ge=0)
    n_a: int = Field(ge=0)
    unverified: int = Field(ge=0)
    actions_open: int = Field(ge=0)
    actions_blocked: int = Field(ge=0)
    blocking_reasons: list[str]
    next_action: str | None
    stages: list[StageProgressResponse]


class SolicitationProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    project_id: str
    issuing_office: str | None
    naics_code: str | None
    psc_code: str | None
    set_aside: str | None
    contract_type: str | None
    points_of_contact: list[dict[str, Any]]
    updated_at: datetime


class SolicitationCandidateResponse(BaseModel):
    id: str
    field_key: SolicitationField
    value: str
    normalized_value: dict[str, Any]
    document_id: str
    document_name: str
    document_classification: DocumentClassification
    document_sha256: str
    is_amendment: bool
    amendment_number: int | None
    explicit_change: bool
    source_start: int = Field(ge=0)
    source_end: int = Field(gt=0)
    source_locator: str
    page_number: int | None
    excerpt: str
    confidence: float = Field(ge=0.0, le=1.0)
    confidence_level: Literal["HIGH", "MEDIUM", "LOW"]
    detection_rationale: str
    detection_pattern: str
    applicable: bool
    needs_input: str | None
    recommended: bool
    conflict: bool


class SolicitationFieldResponse(BaseModel):
    field_key: SolicitationField
    label: str
    repeatable: bool
    status: Literal["NOT_FOUND", "DETECTED", "CONFLICT", "NEEDS_INPUT"]
    conflict: bool
    recommended_candidate_id: str | None
    recommended_candidate_ids: list[str]
    candidates: list[SolicitationCandidateResponse]


class SolicitationDecisionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    run_id: str
    candidate_id: str
    field_key: SolicitationField
    reviewer: str
    previous_value: Any
    applied_value: Any
    applied_at: datetime


class SolicitationAnalysisResponse(BaseModel):
    project_id: str
    run_id: str
    analyzed_at: datetime
    input_fingerprint: str
    rule_version: str
    stale: bool
    project_updated_at: datetime
    profile_updated_at: datetime
    profile: SolicitationProfileResponse
    fields: list[SolicitationFieldResponse]
    decisions: list[SolicitationDecisionResponse]


class SolicitationApproval(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_key: SolicitationField
    candidate_ids: list[str] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_candidate_ids(self) -> SolicitationApproval:
        if len(set(self.candidate_ids)) != len(self.candidate_ids):
            raise ValueError("candidate_ids cannot contain duplicates")
        if self.field_key != SolicitationField.POINTS_OF_CONTACT and len(self.candidate_ids) != 1:
            raise ValueError("Only points_of_contact supports multiple candidate IDs")
        return self


class SolicitationApplyRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    reviewer: str = Field(min_length=1, max_length=150)
    expected_project_updated_at: datetime
    expected_profile_updated_at: datetime
    run_id: str = Field(min_length=1, max_length=36)
    approvals: list[SolicitationApproval] = Field(min_length=1, max_length=9)

    @field_validator("expected_project_updated_at", "expected_profile_updated_at")
    @classmethod
    def require_solicitation_expected_offset(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("expected timestamps must include a UTC offset")
        return value

    @model_validator(mode="after")
    def validate_approval_fields(self) -> SolicitationApplyRequest:
        fields = [approval.field_key for approval in self.approvals]
        if len(set(fields)) != len(fields):
            raise ValueError("Each field_key can appear only once")
        return self


class SolicitationApplyResponse(BaseModel):
    project: ProjectResponse
    profile: SolicitationProfileResponse
    applied_fields: list[SolicitationField]
    decisions: list[SolicitationDecisionResponse]
    analysis: SolicitationAnalysisResponse
