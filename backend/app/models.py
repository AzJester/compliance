from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text
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

    @property
    def sha256(self) -> str:
        return self.blob_sha256

    @property
    def size_bytes(self) -> int:
        return self.blob.size_bytes
