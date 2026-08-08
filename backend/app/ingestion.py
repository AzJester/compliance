from __future__ import annotations

import hashlib
import io
import os
import stat
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings
from .extraction import extract_document
from .models import Blob, Document

MEDIA_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".zip": "application/zip",
}

EXECUTABLE_EXTENSIONS = frozenset(
    {
        ".app",
        ".bat",
        ".cmd",
        ".com",
        ".cpl",
        ".dll",
        ".exe",
        ".hta",
        ".jar",
        ".js",
        ".jse",
        ".lnk",
        ".msi",
        ".msp",
        ".ps1",
        ".reg",
        ".scr",
        ".vbe",
        ".vbs",
        ".wsf",
    }
)

EXECUTABLE_MAGIC = (
    b"MZ",
    b"#!",
    b"\x7fELF",
    b"\xd0\xcf\x11\xe0",
    b"\xca\xfe\xba\xbe",
    b"\xcf\xfa\xed\xfe",
    b"\xfe\xed\xfa\xcf",
)

OOXML_ROOT_PARTS = {
    ".docx": "word/document.xml",
    ".xlsx": "xl/workbook.xml",
    ".pptx": "ppt/presentation.xml",
}


class IngestionError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True, slots=True)
class PreparedDocument:
    name: str
    relative_path: str
    content_type: str
    data: bytes
    sha256: str
    source_archive: str | None


@dataclass(slots=True)
class ArchiveBudget:
    entries: int = 0
    uncompressed_bytes: int = 0


def _normalized_path(name: str, *, root: bool = False) -> str:
    if not name or "\x00" in name:
        raise IngestionError("A file has an invalid name.")
    normalized = name.replace("\\", "/")
    path = PurePosixPath(normalized)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise IngestionError("Archive path traversal is not allowed.")
    if any(":" in part for part in path.parts):
        raise IngestionError("Absolute or drive-qualified paths are not allowed.")
    if root and len(path.parts) != 1:
        raise IngestionError("Uploaded filenames must not contain a path.")
    return path.as_posix()


def _extension(path: str) -> str:
    return PurePosixPath(path.split("!/")[-1]).suffix.lower()


def _validate_type(path: str, data: bytes) -> str:
    extension = _extension(path)
    if extension in EXECUTABLE_EXTENSIONS or data.startswith(EXECUTABLE_MAGIC):
        raise IngestionError("Executable content is not allowed.")
    if extension not in MEDIA_TYPES:
        raise IngestionError(
            "Unsupported file type. Use PDF, DOCX, XLSX, PPTX, or ZIP.",
            status_code=415,
        )
    return extension


def _is_symlink_or_special(info: zipfile.ZipInfo) -> bool:
    mode = info.external_attr >> 16
    file_type = stat.S_IFMT(mode)
    return file_type not in {0, stat.S_IFREG, stat.S_IFDIR}


def _check_archive_member(info: zipfile.ZipInfo, budget: ArchiveBudget, settings: Settings) -> None:
    if info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
        raise IngestionError("The archive uses an unsupported compression method.")
    if info.flag_bits & 0x1:
        raise IngestionError("Encrypted archives are not supported.")
    if _is_symlink_or_special(info):
        raise IngestionError("Archive links and special files are not allowed.")
    if info.file_size > settings.max_file_bytes:
        raise IngestionError("An archive member exceeds the file-size limit.", 413)
    if info.file_size and info.compress_size == 0:
        raise IngestionError("The archive has an unsafe compression ratio.", 413)
    if info.compress_size and info.file_size / info.compress_size > settings.max_compression_ratio:
        raise IngestionError("The archive has an unsafe compression ratio.", 413)

    budget.entries += 1
    budget.uncompressed_bytes += info.file_size
    if budget.entries > settings.max_archive_entries:
        raise IngestionError("The archive contains too many files.", 413)
    if budget.uncompressed_bytes > settings.max_archive_uncompressed_bytes:
        raise IngestionError("The archive expands beyond the configured limit.", 413)


def _validate_ooxml(
    data: bytes,
    extension: str,
    settings: Settings,
    budget: ArchiveBudget,
) -> None:
    """Inspect the OOXML ZIP before any Office parser receives its contents."""

    try:
        package = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, OSError):
        # Malformed Office files are retained with a safe extraction error. A ZIP-looking
        # container, however, must pass every security check below.
        return

    names: set[str] = set()
    with package:
        for info in package.infolist():
            member_name = _normalized_path(info.filename)
            folded_name = member_name.casefold()
            if member_name in names:
                raise IngestionError("The Office package contains duplicate paths.")
            names.add(member_name)
            _check_archive_member(info, budget, settings)
            if info.is_dir():
                continue

            member_path = PurePosixPath(folded_name)
            member_extension = member_path.suffix
            if (
                member_extension in EXECUTABLE_EXTENSIONS
                or member_path.name == "vbaproject.bin"
                or "embeddings" in member_path.parts
                or "activex" in member_path.parts
            ):
                raise IngestionError("Active or embedded content is not allowed in Office files.")
            try:
                member_data = package.read(info)
            except Exception:
                raise IngestionError("The Office package could not be read safely.") from None
            if member_data.startswith(EXECUTABLE_MAGIC):
                raise IngestionError("Embedded executable or OLE content is not allowed.")
            if member_path.name == "[content_types].xml" and (
                b"macroenabled" in member_data.lower() or b"vbaproject" in member_data.lower()
            ):
                raise IngestionError("Macro-enabled Office content is not allowed.")
            # External relationships (including ordinary hyperlinks) remain inert.
            # The supported local parsers never dereference relationship targets.

    if OOXML_ROOT_PARTS[extension] not in {name.casefold() for name in names}:
        raise IngestionError("The Office package does not match its filename type.")


def _validate_container(
    data: bytes,
    extension: str,
    settings: Settings,
    budget: ArchiveBudget,
) -> None:
    if extension in OOXML_ROOT_PARTS:
        _validate_ooxml(data, extension, settings, budget)


def _expand_archive(
    *,
    data: bytes,
    archive_identity: str,
    display_prefix: str,
    depth: int,
    settings: Settings,
    budget: ArchiveBudget,
    output: list[PreparedDocument],
) -> None:
    if depth > settings.max_archive_depth:
        raise IngestionError("The archive nesting depth exceeds the configured limit.", 413)

    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, OSError):
        raise IngestionError("The ZIP archive is invalid or corrupted.") from None

    with archive:
        seen_names: set[str] = set()
        for info in archive.infolist():
            member_name = _normalized_path(info.filename)
            if member_name in seen_names:
                raise IngestionError("The archive contains duplicate paths.")
            seen_names.add(member_name)
            _check_archive_member(info, budget, settings)
            if info.is_dir():
                continue
            try:
                member_data = archive.read(info)
            except Exception:
                raise IngestionError("Archive contents could not be read safely.") from None

            relative_path = f"{display_prefix}{member_name}"
            extension = _validate_type(relative_path, member_data)
            _validate_container(member_data, extension, settings, budget)
            prepared = PreparedDocument(
                name=PurePosixPath(member_name).name,
                relative_path=relative_path,
                content_type=MEDIA_TYPES[extension],
                data=member_data,
                sha256=hashlib.sha256(member_data).hexdigest(),
                source_archive=archive_identity,
            )
            output.append(prepared)

            if extension == ".zip":
                _expand_archive(
                    data=member_data,
                    archive_identity=f"{archive_identity}!/{member_name}",
                    display_prefix=f"{relative_path}!/",
                    depth=depth + 1,
                    settings=settings,
                    budget=budget,
                    output=output,
                )


async def prepare_uploads(uploads: list[UploadFile], settings: Settings) -> list[PreparedDocument]:
    if not uploads:
        raise IngestionError("At least one file is required.", 422)
    if len(uploads) > settings.max_upload_files:
        raise IngestionError("Too many files were uploaded at once.", 413)

    output: list[PreparedDocument] = []
    budget = ArchiveBudget()
    request_bytes = 0
    for upload in uploads:
        filename = _normalized_path(upload.filename or "", root=True)
        data = await upload.read(settings.max_file_bytes + 1)
        if len(data) > settings.max_file_bytes:
            raise IngestionError("An uploaded file exceeds the file-size limit.", 413)
        request_bytes += len(data)
        if request_bytes > settings.max_request_bytes:
            raise IngestionError("The upload exceeds the total request-size limit.", 413)

        extension = _validate_type(filename, data)
        _validate_container(data, extension, settings, budget)
        output.append(
            PreparedDocument(
                name=filename,
                relative_path=filename,
                content_type=MEDIA_TYPES[extension],
                data=data,
                sha256=hashlib.sha256(data).hexdigest(),
                source_archive=None,
            )
        )
        if extension == ".zip":
            _expand_archive(
                data=data,
                archive_identity=filename,
                display_prefix="",
                depth=1,
                settings=settings,
                budget=budget,
                output=output,
            )
    return output


def _write_immutable(path: Path, data: bytes) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        if not path.is_file() or _hash_file(path) != hashlib.sha256(data).hexdigest():
            raise IngestionError("Stored content failed integrity verification.", 409) from None
        return False
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    return True


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _expected_blob_path(settings: Settings, sha256: str) -> tuple[Path, str]:
    relative = Path("blobs") / sha256[:2] / sha256
    return settings.documents_dir / relative, relative.as_posix()


def _verify_or_restore_blob(
    blob: Blob,
    item: PreparedDocument,
    settings: Settings,
) -> None:
    absolute_path, expected_relative = _expected_blob_path(settings, item.sha256)
    if blob.storage_path != expected_relative or blob.size_bytes != len(item.data):
        raise IngestionError("Stored content failed integrity verification.", 409)
    if not absolute_path.exists():
        _write_immutable(absolute_path, item.data)
        return
    if not absolute_path.is_file() or _hash_file(absolute_path) != item.sha256:
        raise IngestionError("Stored content failed integrity verification.", 409)


def store_documents(
    *,
    session: Session,
    project_id: str,
    prepared: list[PreparedDocument],
    settings: Settings,
) -> list[Document]:
    blobs = {
        blob.sha256: blob
        for blob in session.scalars(
            select(Blob).where(Blob.sha256.in_({item.sha256 for item in prepared}))
        )
    }
    first_occurrence: dict[str, Document] = {}
    for existing_document in session.scalars(
        select(Document)
        .where(Document.project_id == project_id)
        .order_by(Document.created_at, Document.id)
    ):
        first_occurrence.setdefault(existing_document.blob_sha256, existing_document)
    results: list[Document] = []

    try:
        for item in prepared:
            blob = blobs.get(item.sha256)
            if blob is None:
                absolute_storage, relative_storage = _expected_blob_path(settings, item.sha256)
                _write_immutable(absolute_storage, item.data)
                blob = Blob(
                    sha256=item.sha256,
                    size_bytes=len(item.data),
                    storage_path=relative_storage,
                )
                session.add(blob)
                session.flush()
                blobs[item.sha256] = blob
            else:
                _verify_or_restore_blob(blob, item, settings)

            duplicate = first_occurrence.get(item.sha256)
            extraction = extract_document(item.relative_path, item.data)
            document = Document(
                project_id=project_id,
                blob_sha256=item.sha256,
                name=item.name,
                relative_path=item.relative_path,
                content_type=item.content_type,
                source_archive=item.source_archive,
                status=extraction.status,
                extraction_count=extraction.character_count,
                error=extraction.error,
                extracted_text=extraction.text,
                duplicate_of=duplicate.id if duplicate is not None else None,
            )
            session.add(document)
            session.flush()
            if duplicate is None:
                first_occurrence[item.sha256] = document
            results.append(document)
        session.commit()
        return results
    except Exception:
        session.rollback()
        # Content-addressed files are never deleted on rollback. Another request may
        # already reference the same immutable bytes, and harmless orphans can be
        # reconciled safely during maintenance.
        raise
