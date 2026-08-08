from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import fitz
from docx import Document as WordDocument
from openpyxl import load_workbook
from pptx import Presentation

from .models import DocumentStatus


@dataclass(frozen=True, slots=True)
class ExtractionResult:
    text: str
    status: DocumentStatus
    error: str | None = None

    @property
    def character_count(self) -> int:
        return len(self.text)


def _clean_text(parts: list[str]) -> str:
    return "\n".join(part.strip() for part in parts if part and part.strip()).strip()


def _extract_pdf(data: bytes) -> ExtractionResult:
    with fitz.open(stream=data, filetype="pdf") as document:
        text = _clean_text([page.get_text("text") for page in document])
    if not text:
        return ExtractionResult(text="", status=DocumentStatus.NEEDS_OCR)
    return ExtractionResult(text=text, status=DocumentStatus.EXTRACTED)


def _extract_docx(data: bytes) -> ExtractionResult:
    document = WordDocument(io.BytesIO(data))
    parts = [paragraph.text for paragraph in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            parts.append("\t".join(cell.text for cell in row.cells))
    return ExtractionResult(text=_clean_text(parts), status=DocumentStatus.EXTRACTED)


def _cell_text(value: object) -> str:
    if value is None:
        return ""
    return str(value)


def _extract_xlsx(data: bytes) -> ExtractionResult:
    # keep_links=False prevents openpyxl from retaining external workbook packages;
    # no supported extractor performs network I/O.
    workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True, keep_links=False)
    parts: list[str] = []
    try:
        for worksheet in workbook.worksheets:
            parts.append(f"[{worksheet.title}]")
            for row in worksheet.iter_rows(values_only=True):
                values = [_cell_text(value) for value in row]
                if any(values):
                    parts.append("\t".join(values))
    finally:
        workbook.close()
    return ExtractionResult(text=_clean_text(parts), status=DocumentStatus.EXTRACTED)


def _extract_pptx(data: bytes) -> ExtractionResult:
    presentation = Presentation(io.BytesIO(data))
    parts: list[str] = []
    for index, slide in enumerate(presentation.slides, start=1):
        parts.append(f"[Slide {index}]")
        for shape in slide.shapes:
            if getattr(shape, "has_text_frame", False):
                parts.append(shape.text)
            if getattr(shape, "has_table", False):
                for row in shape.table.rows:
                    parts.append("\t".join(cell.text for cell in row.cells))
        if slide.has_notes_slide:
            notes_frame = slide.notes_slide.notes_text_frame
            if notes_frame is not None:
                parts.append(notes_frame.text)
    return ExtractionResult(text=_clean_text(parts), status=DocumentStatus.EXTRACTED)


def extract_document(relative_path: str, data: bytes) -> ExtractionResult:
    """Extract local text and reduce parser failures to content-safe user messages."""

    extension = Path(relative_path.split("!/")[-1]).suffix.lower()
    if extension == ".zip":
        return ExtractionResult(text="", status=DocumentStatus.ARCHIVE_EXPANDED)

    extractors = {
        ".pdf": _extract_pdf,
        ".docx": _extract_docx,
        ".xlsx": _extract_xlsx,
        ".pptx": _extract_pptx,
    }
    try:
        return extractors[extension](data)
    except Exception:
        return ExtractionResult(
            text="",
            status=DocumentStatus.ERROR,
            error="The document was preserved, but its text could not be extracted.",
        )
