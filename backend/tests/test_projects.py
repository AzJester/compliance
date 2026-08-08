from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from .conftest import make_test_client


def test_health_is_local_and_telemetry_free(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "host": "127.0.0.1", "telemetry": False}


def test_project_crud(client: TestClient) -> None:
    payload = {
        "name": "  Missile Defense RFP  ",
        "solicitation_number": "HQ0000-26-R-0001",
        "agency": "Missile Defense Agency",
        "due_at": "2026-11-10T14:00:00Z",
        "due_timezone": "America/Denver",
        "sensitivity": "ITAR",
    }

    created_response = client.post("/api/projects", json=payload)
    assert created_response.status_code == 201
    created = created_response.json()
    assert created["name"] == "Missile Defense RFP"
    assert created["sensitivity"] == "ITAR"
    assert created["due_at"] == "2026-11-10T14:00:00Z"
    assert created["id"]
    assert created["created_at"]
    assert created["updated_at"]

    fetched = client.get(f"/api/projects/{created['id']}")
    assert fetched.status_code == 200
    assert fetched.json() == created

    listed = client.get("/api/projects")
    assert listed.status_code == 200
    assert listed.json() == [created]


def test_project_validation_and_missing_project(client: TestClient) -> None:
    assert client.post("/api/projects", json={"name": ""}).status_code == 422
    assert (
        client.post(
            "/api/projects", json={"name": "Example", "sensitivity": "CLASSIFIED"}
        ).status_code
        == 422
    )

    response = client.get("/api/projects/does-not-exist")
    assert response.status_code == 404
    assert response.json()["detail"] == "Project not found."

    naive = client.post(
        "/api/projects",
        json={
            "name": "No offset",
            "due_at": "2026-11-10T14:00:00",
            "due_timezone": "America/Denver",
        },
    )
    assert naive.status_code == 422

    missing_zone = client.post(
        "/api/projects",
        json={"name": "No zone", "due_at": "2026-11-10T14:00:00Z"},
    )
    assert missing_zone.status_code == 422

    invalid_zone = client.post(
        "/api/projects",
        json={
            "name": "Bad zone",
            "due_at": "2026-11-10T14:00:00Z",
            "due_timezone": "Mars/Olympus_Mons",
        },
    )
    assert invalid_zone.status_code == 422


def test_due_date_is_utc_aware_after_database_restart(
    app_factory: Callable[..., FastAPI], tmp_path: Path
) -> None:
    data_dir = tmp_path / "restart"
    with make_test_client(app_factory(data_dir=data_dir)) as first_client:
        response = first_client.post(
            "/api/projects",
            json={
                "name": "Offset deadline",
                "due_at": "2026-07-15T16:00:00-07:00",
                "due_timezone": "America/Phoenix",
            },
        )
        assert response.status_code == 201
        project_id = response.json()["id"]
        assert response.json()["due_at"] == "2026-07-15T23:00:00Z"

    with make_test_client(app_factory(data_dir=data_dir)) as restarted_client:
        restored = restarted_client.get(f"/api/projects/{project_id}")
        assert restored.status_code == 200
        assert restored.json()["due_at"] == "2026-07-15T23:00:00Z"
        assert restored.json()["due_timezone"] == "America/Phoenix"
