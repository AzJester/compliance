from __future__ import annotations

import io
import zipfile
from collections.abc import Callable

from fastapi import FastAPI
from fastapi.testclient import TestClient

from .conftest import docx_bytes, make_test_client, mark_zip_encrypted


def _rewrite_package(data: bytes, additions: dict[str, bytes]) -> bytes:
    source = zipfile.ZipFile(io.BytesIO(data))
    output = io.BytesIO()
    with source, zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as target:
        replaced = set(additions)
        for info in source.infolist():
            if info.filename not in replaced:
                target.writestr(info, source.read(info))
        for name, content in additions.items():
            target.writestr(name, content)
    return output.getvalue()


def _upload(client: TestClient, project_id: str, data: bytes):
    return client.post(
        f"/api/projects/{project_id}/documents",
        files=[("files", ("response.docx", data, "application/octet-stream"))],
    )


def test_external_hyperlink_is_accepted_but_never_dereferenced(
    client: TestClient, project: dict[str, object]
) -> None:
    relationship = b"""
      <Relationship Id="rExternal" Type="urn:test"
        Target="https://example.com/file" TargetMode="External"/>
    """
    original = docx_bytes()
    with zipfile.ZipFile(io.BytesIO(original)) as package:
        relationships = package.read("word/_rels/document.xml.rels")
    relationships = relationships.replace(b"</Relationships>", relationship + b"</Relationships>")
    linked = _rewrite_package(original, {"word/_rels/document.xml.rels": relationships})
    response = _upload(client, str(project["id"]), linked)
    assert response.status_code == 201
    assert response.json()[0]["status"] == "EXTRACTED"


def test_embedded_ole_and_encrypted_office_packages_are_rejected(
    client: TestClient, project: dict[str, object]
) -> None:
    embedded = _rewrite_package(
        docx_bytes(), {"word/embeddings/object1.bin": b"\xd0\xcf\x11\xe0payload"}
    )
    response = _upload(client, str(project["id"]), embedded)
    assert response.status_code == 400
    assert "embedded" in response.json()["detail"].lower()

    encrypted = _upload(client, str(project["id"]), mark_zip_encrypted(docx_bytes()))
    assert encrypted.status_code == 400
    assert "encrypted" in encrypted.json()["detail"].lower()


def test_office_limits_are_aggregate_across_uploads(app_factory: Callable[..., FastAPI]) -> None:
    office = docx_bytes()
    with zipfile.ZipFile(io.BytesIO(office)) as package:
        entry_count = len(package.infolist())

    app = app_factory(max_archive_entries=(entry_count * 2) - 1)
    with make_test_client(app) as client:
        project = client.post("/api/projects", json={"name": "Aggregate"}).json()
        response = client.post(
            f"/api/projects/{project['id']}/documents",
            files=[
                ("files", ("one.docx", office, "application/octet-stream")),
                ("files", ("two.docx", office, "application/octet-stream")),
            ],
        )
    assert response.status_code == 413
