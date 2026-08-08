from __future__ import annotations

import hashlib
import io
from collections.abc import Callable
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import Workbook

from backend.app.extraction import extract_document

from .conftest import (
    docx_bytes,
    make_test_client,
    pdf_bytes,
    pptx_bytes,
    xlsx_bytes,
    zip_bytes,
)


def _upload(client: TestClient, project_id: str, files: list[tuple[str, bytes, str]]):
    return client.post(
        f"/api/projects/{project_id}/documents",
        files=[("files", (name, data, media_type)) for name, data, media_type in files],
    )


def _create_project(client: TestClient, name: str = "Test") -> str:
    response = client.post("/api/projects", json={"name": name})
    assert response.status_code == 201
    return response.json()["id"]


def test_supported_documents_are_preserved_and_extracted(
    client: TestClient, project: dict[str, object]
) -> None:
    content = {
        "rfp.pdf": pdf_bytes(),
        "instructions.docx": docx_bytes(),
        "cdrls.xlsx": xlsx_bytes(),
        "briefing.pptx": pptx_bytes(),
    }
    response = _upload(
        client,
        str(project["id"]),
        [(name, data, "application/octet-stream") for name, data in content.items()],
    )

    assert response.status_code == 201, response.text
    documents = response.json()
    assert {document["name"] for document in documents} == set(content)
    assert all(document["status"] == "EXTRACTED" for document in documents)
    assert all(document["extraction_count"] > 0 for document in documents)
    assert all(document["error"] is None for document in documents)
    for document in documents:
        assert document["sha256"] == hashlib.sha256(content[document["name"]]).hexdigest()

    listing = client.get(f"/api/projects/{project['id']}/documents")
    assert listing.status_code == 200
    assert {item["id"] for item in listing.json()} == {item["id"] for item in documents}


def test_extractors_emit_truthful_source_markers_and_keep_visible_leading_zeros() -> None:
    assert "[PDF Page 1]" in extract_document("rfp.pdf", pdf_bytes()).text
    assert "[DOCX Paragraph 1]" in extract_document("response.docx", docx_bytes()).text
    assert "[Slide 1]" in extract_document("briefing.pptx", pptx_bytes()).text

    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    sheet.title = "CDRL"
    sheet["A1"] = 7
    sheet["A1"].number_format = "0000"
    stream = io.BytesIO()
    workbook.save(stream)
    workbook.close()
    extracted = extract_document("cdrl.xlsx", stream.getvalue()).text
    assert '[XLSX Sheet "CDRL" Row 1]' in extracted
    assert "0007" in extracted


def test_blank_pdf_needs_ocr_and_parser_error_is_safe(
    client: TestClient, project: dict[str, object]
) -> None:
    response = _upload(
        client,
        str(project["id"]),
        [
            ("scan.pdf", pdf_bytes(""), "application/pdf"),
            ("broken.docx", b"not an OOXML package", "application/octet-stream"),
        ],
    )

    assert response.status_code == 201
    by_name = {item["name"]: item for item in response.json()}
    assert by_name["scan.pdf"]["status"] == "NEEDS_OCR"
    assert by_name["scan.pdf"]["extraction_count"] == 0
    assert by_name["broken.docx"]["status"] == "ERROR"
    assert by_name["broken.docx"]["error"] == (
        "The document was preserved, but its text could not be extracted."
    )


def test_recursive_zip_expansion(client: TestClient, project: dict[str, object]) -> None:
    nested = zip_bytes({"tables/cdrl.xlsx": xlsx_bytes()})
    package = zip_bytes(
        {
            "sections/instructions.docx": docx_bytes(),
            "attachments/nested.zip": nested,
        }
    )

    response = _upload(
        client, str(project["id"]), [("solicitation.zip", package, "application/zip")]
    )

    assert response.status_code == 201, response.text
    by_path = {item["relative_path"]: item for item in response.json()}
    assert by_path["solicitation.zip"]["status"] == "ARCHIVE_EXPANDED"
    assert by_path["sections/instructions.docx"]["source_archive"] == "solicitation.zip"
    assert by_path["attachments/nested.zip"]["status"] == "ARCHIVE_EXPANDED"
    nested_document = by_path["attachments/nested.zip!/tables/cdrl.xlsx"]
    assert nested_document["status"] == "EXTRACTED"
    assert nested_document["source_archive"] == ("solicitation.zip!/attachments/nested.zip")


def test_sha256_deduplicates_within_a_project(
    client: TestClient, project: dict[str, object]
) -> None:
    data = pdf_bytes()
    first = _upload(client, str(project["id"]), [("first.pdf", data, "application/pdf")])
    second = _upload(client, str(project["id"]), [("renamed.pdf", data, "application/pdf")])

    assert first.status_code == second.status_code == 201
    assert second.json()[0]["id"] != first.json()[0]["id"]
    assert second.json()[0]["duplicate_of"] == first.json()[0]["id"]
    listing = client.get(f"/api/projects/{project['id']}/documents")
    assert len(listing.json()) == 2


def test_missing_blob_is_restored_and_tampering_is_rejected(
    client: TestClient, project: dict[str, object]
) -> None:
    data = pdf_bytes()
    uploaded = _upload(
        client, str(project["id"]), [("original.pdf", data, "application/pdf")]
    ).json()[0]
    settings = client.app.state.settings
    blob_path = settings.documents_dir / "blobs" / uploaded["sha256"][:2] / uploaded["sha256"]
    blob_path.unlink()

    restored = _upload(client, str(project["id"]), [("restored.pdf", data, "application/pdf")])
    assert restored.status_code == 201
    assert blob_path.read_bytes() == data

    blob_path.write_bytes(b"tampered")
    rejected = _upload(client, str(project["id"]), [("third.pdf", data, "application/pdf")])
    assert rejected.status_code == 409
    assert "integrity" in rejected.json()["detail"].lower()
    assert blob_path.read_bytes() == b"tampered"
    assert len(client.get(f"/api/projects/{project['id']}/documents").json()) == 2


def test_unsupported_and_executable_inputs_are_rejected_atomically(
    client: TestClient, project: dict[str, object]
) -> None:
    unsupported = _upload(client, str(project["id"]), [("notes.txt", b"hello", "text/plain")])
    assert unsupported.status_code == 415

    executable = _upload(
        client,
        str(project["id"]),
        [
            ("valid.pdf", pdf_bytes(), "application/pdf"),
            ("payload.exe", b"MZpayload", "application/octet-stream"),
        ],
    )
    assert executable.status_code == 400
    assert client.get(f"/api/projects/{project['id']}/documents").json() == []


def test_missing_project_and_project_data_isolation(
    app_factory: Callable[..., FastAPI], tmp_path: Path
) -> None:
    app = app_factory(data_dir=tmp_path / "isolated")
    with make_test_client(app) as client:
        missing = _upload(client, "missing", [("rfp.pdf", pdf_bytes(), "application/pdf")])
        assert missing.status_code == 404
        assert client.get("/api/projects/missing/documents").status_code == 404

        project_a = _create_project(client, "A")
        project_b = _create_project(client, "B")
        same_data = pdf_bytes()
        assert (
            _upload(client, project_a, [("a.pdf", same_data, "application/pdf")]).status_code == 201
        )
        assert (
            _upload(client, project_b, [("b.pdf", same_data, "application/pdf")]).status_code == 201
        )

        documents_a = client.get(f"/api/projects/{project_a}/documents").json()
        documents_b = client.get(f"/api/projects/{project_b}/documents").json()
        assert len(documents_a) == len(documents_b) == 1
        assert documents_a[0]["id"] != documents_b[0]["id"]
        blob_path = (
            tmp_path
            / "isolated"
            / "projects"
            / "blobs"
            / documents_a[0]["sha256"][:2]
            / documents_a[0]["sha256"]
        )
        assert blob_path.is_file()

    with make_test_client(app_factory(data_dir=tmp_path / "separate-instance")) as other_client:
        assert other_client.get("/api/projects").json() == []
