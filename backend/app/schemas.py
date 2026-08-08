from __future__ import annotations

from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .models import (
    DocumentStatus,
    ObligationOwner,
    RequirementApplicability,
    RequirementCategory,
    RequirementSection,
    ReviewAction,
    Sensitivity,
    ValidationStatus,
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
