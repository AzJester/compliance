from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .models import DocumentStatus, Sensitivity


class ProjectCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: str = Field(min_length=1, max_length=250)
    solicitation_number: str | None = Field(default=None, max_length=150)
    agency: str | None = Field(default=None, max_length=250)
    due_at: datetime | None = None
    due_timezone: str | None = Field(default=None, max_length=100)
    sensitivity: Sensitivity = Sensitivity.PUBLIC

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
