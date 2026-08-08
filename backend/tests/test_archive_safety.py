from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from .conftest import (
    make_test_client,
    mark_zip_encrypted,
    mark_zip_unsupported_compression,
    pdf_bytes,
    zip_bytes,
)


def _client_and_project(app: FastAPI) -> tuple[TestClient, str]:
    client = make_test_client(app)
    client.__enter__()
    response = client.post("/api/projects", json={"name": "Archive test"})
    assert response.status_code == 201
    return client, response.json()["id"]


def _upload(client: TestClient, project_id: str, data: bytes):
    return client.post(
        f"/api/projects/{project_id}/documents",
        files=[("files", ("package.zip", data, "application/zip"))],
    )


@pytest.mark.parametrize(
    "unsafe_name", ["../escape.pdf", "folder/../../escape.pdf", "C:/escape.pdf"]
)
def test_archive_path_traversal_is_rejected(
    app_factory: Callable[..., FastAPI], unsafe_name: str
) -> None:
    client, project_id = _client_and_project(app_factory())
    try:
        response = _upload(client, project_id, zip_bytes({unsafe_name: pdf_bytes()}))
        assert response.status_code == 400
        assert "path" in response.json()["detail"].lower()
        assert client.get(f"/api/projects/{project_id}/documents").json() == []
    finally:
        client.__exit__(None, None, None)


def test_encrypted_archive_is_rejected(app_factory: Callable[..., FastAPI]) -> None:
    client, project_id = _client_and_project(app_factory())
    try:
        encrypted = mark_zip_encrypted(zip_bytes({"rfp.pdf": pdf_bytes()}))
        response = _upload(client, project_id, encrypted)
        assert response.status_code == 400
        assert "encrypted" in response.json()["detail"].lower()
    finally:
        client.__exit__(None, None, None)


def test_unsupported_compression_is_rejected(app_factory: Callable[..., FastAPI]) -> None:
    client, project_id = _client_and_project(app_factory())
    try:
        package = mark_zip_unsupported_compression(
            zip_bytes({"rfp.pdf": pdf_bytes()}, compression=0)
        )
        response = _upload(client, project_id, package)
        assert response.status_code == 400
        assert "compression method" in response.json()["detail"].lower()
    finally:
        client.__exit__(None, None, None)


def test_archive_entry_count_limit(app_factory: Callable[..., FastAPI]) -> None:
    client, project_id = _client_and_project(app_factory(max_archive_entries=1))
    try:
        package = zip_bytes({"one.pdf": pdf_bytes("one"), "two.pdf": pdf_bytes("two")})
        response = _upload(client, project_id, package)
        assert response.status_code == 413
        assert "too many" in response.json()["detail"].lower()
    finally:
        client.__exit__(None, None, None)


def test_archive_uncompressed_limit(app_factory: Callable[..., FastAPI]) -> None:
    client, project_id = _client_and_project(
        app_factory(max_archive_uncompressed_bytes=100, max_file_bytes=10_000)
    )
    try:
        response = _upload(client, project_id, zip_bytes({"large.pdf": b"x" * 101}))
        assert response.status_code == 413
        assert "configured limit" in response.json()["detail"].lower()
    finally:
        client.__exit__(None, None, None)


def test_individual_file_limit(app_factory: Callable[..., FastAPI]) -> None:
    client, project_id = _client_and_project(app_factory(max_file_bytes=10))
    try:
        response = client.post(
            f"/api/projects/{project_id}/documents",
            files=[("files", ("too-large.pdf", b"x" * 11, "application/pdf"))],
        )
        assert response.status_code == 413
        assert "file-size" in response.json()["detail"].lower()
    finally:
        client.__exit__(None, None, None)
