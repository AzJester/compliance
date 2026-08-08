from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from backend.app.database import create_database, initialize_database
from backend.app.models import SolicitationAnalysisRun, SolicitationProfile

from .conftest import seed_extracted_document


def _create_project(client: TestClient, name: str = "Metadata placeholder") -> dict[str, object]:
    response = client.post("/api/projects", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def _classify(client: TestClient, project_id: str, document_id: str, classification: str) -> None:
    response = client.patch(
        f"/api/projects/{project_id}/documents/{document_id}/profile",
        json={"classification": classification},
    )
    assert response.status_code == 200, response.text


def _base_text(*, timezone: str = "Eastern Time") -> str:
    return "\n".join(
        (
            "[PDF Page 1]",
            "Solicitation Number: W91SYN-26-R-0042",
            "Project Title: Synthetic Mission Support",
            "Issued By: Department of the Army, Synthetic Contracting Office",
            "NAICS Code: 541512",
            "Product Service Code: DA01",
            "Set-Aside Type: Total Small Business Set-Aside",
            "Contract Type: Firm-Fixed-Price",
            "Questions due: August 20, 2026 at 3:00 PM Eastern Time",
            f"Proposals are due: September 15, 2026 at 4:00 PM {timezone}",
            "Primary Point of Contact: Jane Example",
            "jane.example@example.invalid",
            "(555) 555-0100",
        )
    )


def _field(analysis: dict[str, object], key: str) -> dict[str, object]:
    fields = analysis["fields"]
    assert isinstance(fields, list)
    return next(field for field in fields if field["field_key"] == key)


def _analyzed_project(
    client: TestClient, *, timezone: str = "Eastern Time"
) -> tuple[dict[str, object], str, dict[str, object]]:
    project = _create_project(client)
    project_id = str(project["id"])
    document_id = seed_extracted_document(
        client,
        project_id,
        _base_text(timezone=timezone),
        name="synthetic-base-solicitation.pdf",
    )
    _classify(client, project_id, document_id, "BASE_SOLICITATION")
    response = client.post(f"/api/projects/{project_id}/solicitation-details/analyze")
    assert response.status_code == 200, response.text
    return project, document_id, response.json()


def test_detects_evidence_backed_metadata_idempotently_without_mutating_project(
    client: TestClient,
) -> None:
    project = _create_project(client)
    project_id = str(project["id"])
    assert client.get(f"/api/projects/{project_id}/solicitation-details").status_code == 404

    unclassified_id = seed_extracted_document(
        client, project_id, _base_text(), name="not-yet-authoritative.pdf"
    )
    empty = client.post(f"/api/projects/{project_id}/solicitation-details/analyze")
    assert empty.status_code == 200
    assert all(not field["candidates"] for field in empty.json()["fields"])

    _classify(client, project_id, unclassified_id, "BASE_SOLICITATION")
    assert client.get(f"/api/projects/{project_id}/solicitation-details").json()["stale"] is True
    first = client.post(f"/api/projects/{project_id}/solicitation-details/analyze")
    second = client.post(f"/api/projects/{project_id}/solicitation-details/analyze")
    assert first.status_code == second.status_code == 200
    analysis = first.json()
    assert analysis["run_id"] == second.json()["run_id"]
    assert analysis["stale"] is False

    expected = {
        "title",
        "solicitation_number",
        "agency",
        "due_at",
        "naics_code",
        "psc_code",
        "set_aside",
        "contract_type",
        "points_of_contact",
    }
    assert {field["field_key"] for field in analysis["fields"]} == expected
    for key in expected:
        field = _field(analysis, key)
        assert field["candidates"], key
        candidate = field["candidates"][0]
        assert candidate["document_id"] == unclassified_id
        assert candidate["document_classification"] == "BASE_SOLICITATION"
        assert candidate["document_sha256"]
        assert candidate["source_locator"].startswith("PDF Page 1;")
        source = _base_text()[candidate["source_start"] : candidate["source_end"]]
        assert source == candidate["excerpt"]
        assert candidate["confidence_level"] in {"HIGH", "MEDIUM", "LOW"}
        assert candidate["detection_rationale"]

    due = _field(analysis, "due_at")
    assert len(due["candidates"]) == 1
    assert "Questions due" not in due["candidates"][0]["excerpt"]
    assert due["candidates"][0]["normalized_value"]["due_timezone"] == "America/New_York"
    assert client.get(f"/api/projects/{project_id}").json()["name"] == "Metadata placeholder"

    session_factory = client.app.state.session_factory
    with session_factory() as session:
        assert (
            session.scalar(
                select(func.count(SolicitationAnalysisRun.id)).where(
                    SolicitationAnalysisRun.project_id == project_id
                )
            )
            == 2
        )


def test_numbered_explicit_amendment_recommends_new_deadline(client: TestClient) -> None:
    _, _, analysis = _analyzed_project(client)
    project_id = str(analysis["project_id"])
    amendment_text = "\n".join(
        (
            "[PDF Page 1]",
            "AMENDMENT NUMBER: 0002",
            "Receipt of offers is extended to September 22, 2026 at 4:00 PM Eastern Time",
        )
    )
    amendment_id = seed_extracted_document(
        client, project_id, amendment_text, name="amendment-0002.pdf"
    )
    _classify(client, project_id, amendment_id, "AMENDMENT")
    assert client.get(f"/api/projects/{project_id}/solicitation-details").json()["stale"] is True

    updated = client.post(f"/api/projects/{project_id}/solicitation-details/analyze").json()
    due = _field(updated, "due_at")
    assert due["status"] == "CONFLICT"
    assert due["conflict"] is True
    recommended = next(
        candidate
        for candidate in due["candidates"]
        if candidate["id"] == due["recommended_candidate_id"]
    )
    assert recommended["document_id"] == amendment_id
    assert recommended["is_amendment"] is True
    assert recommended["amendment_number"] == 2
    assert recommended["explicit_change"] is True
    assert recommended["normalized_value"]["due_at"] == "2026-09-22T20:00:00Z"


def test_conflicting_amendment_without_reliable_precedence_has_no_recommendation(
    client: TestClient,
) -> None:
    _, _, analysis = _analyzed_project(client)
    project_id = str(analysis["project_id"])
    amendment_id = seed_extracted_document(
        client,
        project_id,
        "Receipt of offers is extended to September 30, 2026 at 4:00 PM Eastern Time",
        name="unnumbered-amendment.pdf",
    )
    _classify(client, project_id, amendment_id, "AMENDMENT")
    updated = client.post(f"/api/projects/{project_id}/solicitation-details/analyze").json()
    due = _field(updated, "due_at")
    assert due["status"] == "CONFLICT"
    assert due["recommended_candidate_id"] is None
    assert due["recommended_candidate_ids"] == []


def test_apply_updates_only_approved_values_and_records_reviewer(client: TestClient) -> None:
    project, _, analysis = _analyzed_project(client)
    project_id = str(project["id"])
    approved_fields = (
        "title",
        "solicitation_number",
        "agency",
        "due_at",
        "naics_code",
        "psc_code",
        "set_aside",
        "contract_type",
        "points_of_contact",
    )
    approvals = []
    for key in approved_fields:
        field = _field(analysis, key)
        approvals.append(
            {
                "field_key": key,
                "candidate_ids": field["recommended_candidate_ids"],
            }
        )
    response = client.post(
        f"/api/projects/{project_id}/solicitation-details/apply",
        json={
            "reviewer": "Self-reported metadata reviewer",
            "expected_project_updated_at": analysis["project_updated_at"],
            "expected_profile_updated_at": analysis["profile_updated_at"],
            "run_id": analysis["run_id"],
            "approvals": approvals,
        },
    )
    assert response.status_code == 200, response.text
    applied = response.json()
    assert set(applied["applied_fields"]) == set(approved_fields)
    assert applied["project"]["name"] == "Synthetic Mission Support"
    assert applied["project"]["solicitation_number"] == "W91SYN-26-R-0042"
    assert applied["project"]["agency"].startswith("Department of the Army")
    assert applied["project"]["due_at"] == "2026-09-15T20:00:00Z"
    assert applied["project"]["due_timezone"] == "America/New_York"
    assert applied["profile"]["naics_code"] == "541512"
    assert applied["profile"]["psc_code"] == "DA01"
    assert applied["profile"]["set_aside"] == "Total Small Business Set-Aside"
    assert applied["profile"]["contract_type"] == "Firm-Fixed-Price"
    assert applied["profile"]["issuing_office"].endswith("Synthetic Contracting Office")
    assert applied["profile"]["points_of_contact"][0]["email"] == ("jane.example@example.invalid")
    assert all(
        decision["reviewer"] == "Self-reported metadata reviewer"
        for decision in applied["decisions"]
    )
    assert applied["analysis"]["stale"] is False


def test_ambiguous_timezone_cannot_be_applied_and_apply_is_atomic(client: TestClient) -> None:
    project, _, analysis = _analyzed_project(client, timezone="local time")
    project_id = str(project["id"])
    due = _field(analysis, "due_at")
    assert due["status"] == "NEEDS_INPUT"
    assert due["candidates"][0]["applicable"] is False
    title = _field(analysis, "title")
    response = client.post(
        f"/api/projects/{project_id}/solicitation-details/apply",
        json={
            "reviewer": "Reviewer",
            "expected_project_updated_at": analysis["project_updated_at"],
            "expected_profile_updated_at": analysis["profile_updated_at"],
            "run_id": analysis["run_id"],
            "approvals": [
                {
                    "field_key": "title",
                    "candidate_ids": [title["candidates"][0]["id"]],
                },
                {
                    "field_key": "due_at",
                    "candidate_ids": [due["candidates"][0]["id"]],
                },
            ],
        },
    )
    assert response.status_code == 422
    assert client.get(f"/api/projects/{project_id}").json()["name"] == "Metadata placeholder"


def test_stale_and_cross_project_candidates_are_rejected(client: TestClient) -> None:
    project, _, analysis = _analyzed_project(client)
    other_project, _, other_analysis = _analyzed_project(client)
    project_id = str(project["id"])
    title = _field(analysis, "title")["candidates"][0]
    other_title = _field(other_analysis, "title")["candidates"][0]

    cross_project = client.post(
        f"/api/projects/{project_id}/solicitation-details/apply",
        json={
            "reviewer": "Reviewer",
            "expected_project_updated_at": analysis["project_updated_at"],
            "expected_profile_updated_at": analysis["profile_updated_at"],
            "run_id": analysis["run_id"],
            "approvals": [
                {"field_key": "title", "candidate_ids": [other_title["id"]]},
            ],
        },
    )
    assert cross_project.status_code == 422

    changed_id = seed_extracted_document(
        client,
        project_id,
        "AMENDMENT NUMBER 0003\nSolicitation Number: W91SYN-26-R-9999",
        name="amendment-0003.pdf",
    )
    _classify(client, project_id, changed_id, "AMENDMENT")
    stale = client.post(
        f"/api/projects/{project_id}/solicitation-details/apply",
        json={
            "reviewer": "Reviewer",
            "expected_project_updated_at": analysis["project_updated_at"],
            "expected_profile_updated_at": analysis["profile_updated_at"],
            "run_id": analysis["run_id"],
            "approvals": [{"field_key": "title", "candidate_ids": [title["id"]]}],
        },
    )
    assert stale.status_code == 409
    assert client.get(f"/api/projects/{project_id}").json()["name"] == "Metadata placeholder"
    assert other_project["name"] == "Metadata placeholder"


def test_manual_project_change_triggers_optimistic_concurrency(client: TestClient) -> None:
    project, _, analysis = _analyzed_project(client)
    project_id = str(project["id"])
    title = _field(analysis, "title")["candidates"][0]
    patch = client.patch(f"/api/projects/{project_id}", json={"name": "Manual reviewer value"})
    assert patch.status_code == 200
    response = client.post(
        f"/api/projects/{project_id}/solicitation-details/apply",
        json={
            "reviewer": "Reviewer",
            "expected_project_updated_at": analysis["project_updated_at"],
            "expected_profile_updated_at": analysis["profile_updated_at"],
            "run_id": analysis["run_id"],
            "approvals": [{"field_key": "title", "candidate_ids": [title["id"]]}],
        },
    )
    assert response.status_code == 409
    assert client.get(f"/api/projects/{project_id}").json()["name"] == "Manual reviewer value"


def test_additive_profile_migration_backfills_existing_project(tmp_path: Path) -> None:
    database_path = tmp_path / "legacy.sqlite3"
    connection = sqlite3.connect(database_path)
    connection.execute(
        """
        CREATE TABLE projects (
            id VARCHAR(36) PRIMARY KEY,
            name VARCHAR(250) NOT NULL,
            solicitation_number VARCHAR(150),
            agency VARCHAR(250),
            due_at DATETIME,
            due_timezone VARCHAR(100),
            sensitivity VARCHAR(6) NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL
        )
        """
    )
    connection.execute(
        "INSERT INTO projects VALUES (?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)",
        (
            "00000000-0000-0000-0000-000000000001",
            "Legacy project",
            "PUBLIC",
            "2026-01-01 00:00:00",
            "2026-01-01 00:00:00",
        ),
    )
    connection.commit()
    connection.close()

    engine, session_factory = create_database(database_path)
    initialize_database(engine)
    initialize_database(engine)
    with session_factory() as session:
        profiles = list(session.scalars(select(SolicitationProfile)))
        assert len(profiles) == 1
        assert profiles[0].project_id == "00000000-0000-0000-0000-000000000001"
        assert profiles[0].points_of_contact == []
    engine.dispose()


def test_common_space_delimiters_and_deadline_orders_are_detected(client: TestClient) -> None:
    project = _create_project(client)
    project_id = str(project["id"])
    text = "\n".join(
        (
            "SOLICITATION NO. W91SYN-26-R-0042",
            "NAICS CODE 541512",
            "Offers are due 2:00 P.M. Mountain Time on September 5, 2026.",
            "Offers are due 5 October 2026 at 2:00 PM UTC",
        )
    )
    document_id = seed_extracted_document(client, project_id, text, name="common-forms.pdf")
    _classify(client, project_id, document_id, "BASE_SOLICITATION")
    analysis = client.post(f"/api/projects/{project_id}/solicitation-details/analyze").json()
    assert _field(analysis, "solicitation_number")["candidates"][0]["value"] == ("W91SYN-26-R-0042")
    assert _field(analysis, "naics_code")["candidates"][0]["value"] == "541512"
    due_values = {
        candidate["normalized_value"]["due_at"]
        for candidate in _field(analysis, "due_at")["candidates"]
    }
    assert due_values == {"2026-09-05T20:00:00Z", "2026-10-05T14:00:00Z"}


def test_explicit_standard_timezone_uses_exact_fixed_iana_offset(client: TestClient) -> None:
    project = _create_project(client)
    project_id = str(project["id"])
    document_id = seed_extracted_document(
        client,
        project_id,
        "OFFERS ARE DUE JULY 15, 2026 AT 2:00 P.M. EST.",
        name="fixed-standard-time.pdf",
    )
    _classify(client, project_id, document_id, "BASE_SOLICITATION")
    analysis = client.post(f"/api/projects/{project_id}/solicitation-details/analyze").json()
    due = _field(analysis, "due_at")["candidates"][0]
    assert due["normalized_value"]["due_at"] == "2026-07-15T19:00:00Z"
    assert due["normalized_value"]["due_timezone"] == "Etc/GMT+5"


def test_equivalent_timezone_labels_do_not_create_false_conflict(client: TestClient) -> None:
    project = _create_project(client)
    project_id = str(project["id"])
    base_id = seed_extracted_document(
        client,
        project_id,
        "Offers are due September 5, 2026 at 2:00 PM MT",
        name="base.pdf",
    )
    amendment_id = seed_extracted_document(
        client,
        project_id,
        "AMENDMENT NUMBER 0001\nOffers are due September 5, 2026 at 2:00 PM Mountain Time",
        name="amendment-0001.pdf",
    )
    _classify(client, project_id, base_id, "BASE_SOLICITATION")
    _classify(client, project_id, amendment_id, "AMENDMENT")
    analysis = client.post(f"/api/projects/{project_id}/solicitation-details/analyze").json()
    due = _field(analysis, "due_at")
    assert len(due["candidates"]) == 2
    assert due["conflict"] is False
    assert due["status"] == "DETECTED"


def test_candidate_safety_limit_fails_without_persisting_partial_run(client: TestClient) -> None:
    project = _create_project(client)
    project_id = str(project["id"])
    text = "\n".join(f"Solicitation Number: W91SYN-26-R-{index:04d}" for index in range(51))
    document_id = seed_extracted_document(client, project_id, text, name="candidate-flood.pdf")
    _classify(client, project_id, document_id, "BASE_SOLICITATION")
    response = client.post(f"/api/projects/{project_id}/solicitation-details/analyze")
    assert response.status_code == 413
    assert "safety limit" in response.json()["detail"]

    session_factory = client.app.state.session_factory
    with session_factory() as session:
        assert (
            session.scalar(
                select(func.count(SolicitationAnalysisRun.id)).where(
                    SolicitationAnalysisRun.project_id == project_id
                )
            )
            == 0
        )


def test_explicit_fsc_label_aliases_populate_psc_code(client: TestClient) -> None:
    project = _create_project(client)
    project_id = str(project["id"])
    document_id = seed_extracted_document(
        client,
        project_id,
        "FSC CODE DA01\nFederal Supply Classification: 7030",
        name="fsc-labels.pdf",
    )
    _classify(client, project_id, document_id, "BASE_SOLICITATION")
    response = client.post(f"/api/projects/{project_id}/solicitation-details/analyze")
    assert response.status_code == 200, response.text
    field = _field(response.json(), "psc_code")
    assert {candidate["normalized_value"]["psc_code"] for candidate in field["candidates"]} == {
        "7030",
        "DA01",
    }
    assert all(candidate["detection_pattern"] == "labeled-psc" for candidate in field["candidates"])


def test_unlabeled_four_character_code_is_not_inferred_as_psc(client: TestClient) -> None:
    project = _create_project(client)
    project_id = str(project["id"])
    document_id = seed_extracted_document(
        client,
        project_id,
        "Classification reference DA01 appears without a procurement code label.",
        name="unlabeled-code.pdf",
    )
    _classify(client, project_id, document_id, "BASE_SOLICITATION")
    response = client.post(f"/api/projects/{project_id}/solicitation-details/analyze")
    assert response.status_code == 200, response.text
    assert _field(response.json(), "psc_code")["candidates"] == []


def test_ambiguous_dst_fold_deadline_requires_reviewer_input(client: TestClient) -> None:
    project = _create_project(client)
    project_id = str(project["id"])
    document_id = seed_extracted_document(
        client,
        project_id,
        "Offers are due November 1, 2026 at 1:30 AM ET",
        name="ambiguous-fold.pdf",
    )
    _classify(client, project_id, document_id, "BASE_SOLICITATION")
    response = client.post(f"/api/projects/{project_id}/solicitation-details/analyze")
    assert response.status_code == 200, response.text
    field = _field(response.json(), "due_at")
    assert field["status"] == "NEEDS_INPUT"
    candidate = field["candidates"][0]
    assert candidate["applicable"] is False
    assert candidate["normalized_value"].get("due_at") is None
    assert "ambiguous" in candidate["needs_input"]


def test_nonexistent_dst_gap_deadline_requires_reviewer_input(client: TestClient) -> None:
    project = _create_project(client)
    project_id = str(project["id"])
    document_id = seed_extracted_document(
        client,
        project_id,
        "Offers are due March 8, 2026 at 2:30 AM ET",
        name="nonexistent-gap.pdf",
    )
    _classify(client, project_id, document_id, "BASE_SOLICITATION")
    response = client.post(f"/api/projects/{project_id}/solicitation-details/analyze")
    assert response.status_code == 200, response.text
    field = _field(response.json(), "due_at")
    assert field["status"] == "NEEDS_INPUT"
    candidate = field["candidates"][0]
    assert candidate["applicable"] is False
    assert candidate["normalized_value"].get("due_at") is None
    assert "nonexistent" in candidate["needs_input"]


def test_explicit_fixed_daylight_abbreviation_remains_applicable_at_dst_gap(
    client: TestClient,
) -> None:
    project = _create_project(client)
    project_id = str(project["id"])
    document_id = seed_extracted_document(
        client,
        project_id,
        "Offers are due March 8, 2026 at 2:30 AM EDT",
        name="explicit-fixed-edt.pdf",
    )
    _classify(client, project_id, document_id, "BASE_SOLICITATION")
    response = client.post(f"/api/projects/{project_id}/solicitation-details/analyze")
    assert response.status_code == 200, response.text
    candidate = _field(response.json(), "due_at")["candidates"][0]
    assert candidate["applicable"] is True
    assert candidate["normalized_value"]["due_at"] == "2026-03-08T06:30:00Z"
    assert candidate["normalized_value"]["due_timezone"] == "Etc/GMT+4"


def test_explicit_fixed_standard_abbreviation_remains_applicable_at_dst_fold(
    client: TestClient,
) -> None:
    project = _create_project(client)
    project_id = str(project["id"])
    document_id = seed_extracted_document(
        client,
        project_id,
        "Offers are due November 1, 2026 at 1:30 AM EST",
        name="explicit-fixed-est.pdf",
    )
    _classify(client, project_id, document_id, "BASE_SOLICITATION")
    response = client.post(f"/api/projects/{project_id}/solicitation-details/analyze")
    assert response.status_code == 200, response.text
    candidate = _field(response.json(), "due_at")["candidates"][0]
    assert candidate["applicable"] is True
    assert candidate["normalized_value"]["due_at"] == "2026-11-01T06:30:00Z"
    assert candidate["normalized_value"]["due_timezone"] == "Etc/GMT+5"


def test_agency_value_longer_than_project_limit_is_not_a_candidate(client: TestClient) -> None:
    project = _create_project(client)
    project_id = str(project["id"])
    document_id = seed_extracted_document(
        client,
        project_id,
        f"Issued By: {'A' * 251}",
        name="overlong-agency.pdf",
    )
    _classify(client, project_id, document_id, "BASE_SOLICITATION")
    response = client.post(f"/api/projects/{project_id}/solicitation-details/analyze")
    assert response.status_code == 200, response.text
    assert _field(response.json(), "agency")["candidates"] == []
