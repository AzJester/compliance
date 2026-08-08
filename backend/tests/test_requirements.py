from __future__ import annotations

import socket
import string
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from backend.app import requirements_api, requirements_service
from backend.app.models import DocumentStatus
from backend.app.requirements_rules import MAX_CDRL_SOURCE_CHARACTERS

from .conftest import make_test_client, seed_extracted_document


def _extract(client: TestClient, project_id: str):
    return client.post(f"/api/projects/{project_id}/requirements/extract")


def _requirements(client: TestClient, project_id: str, query: str = ""):
    return client.get(f"/api/projects/{project_id}/requirements{query}")


def _create_project(client: TestClient, name: str = "Candidate limit test") -> dict[str, object]:
    response = client.post("/api/projects", json={"name": name})
    assert response.status_code == 201
    return response.json()


def _assert_empty_registers(client: TestClient, project_id: str) -> None:
    assert _requirements(client, project_id).json() == []
    assert client.get(f"/api/projects/{project_id}/cdrls").json() == []


def _full_cdrl() -> str:
    values = {
        "A": "0001",
        "B": "A",
        "C": "TDP",
        "D": "AIR VEHICLE",
        "E": "FA0000-26-C-0001",
        "F": "SYNTHETIC CONTRACTOR",
        "1": "A001",
        "2": "MONTHLY STATUS REPORT",
        "3": "TECHNICAL PROGRESS",
        "4": "DI-MGMT-80368",
        "5": "PWS 3.2.1",
        "6": "AFLCMC/TEST",
        "7": "LT",
        "8": "A",
        "9": "D",
        "10": "MTHLY",
        "11": "20260901",
        "12": "030 DAC",
        "13": "15 DARP",
        "14": "Draft copies: 01\nFinal copies: 02\nDestination: AFLCMC",
        "15": "003",
        "16": "Tailor paragraph 10.2.\nRetain all tables and source references.",
        "17": "A",
        "18": "$000000",
    }
    return "DD FORM 1423\n" + "\n".join(
        f"Block {block}: {value}" for block, value in values.items()
    )


def test_all_sections_modal_splitting_categories_and_exact_spans(
    client: TestClient, project: dict[str, object]
) -> None:
    section_text = []
    for section in string.ascii_uppercase[:13]:
        section_text.extend(
            (
                f"SECTION {section} - SYNTHETIC HEADING",
                f"The contractor shall satisfy the Section {section} obligation.",
            )
        )
    section_text.extend(
        (
            "SECTION L - INSTRUCTIONS TO OFFERORS",
            "The offeror must use twelve-point font and the offeror shall include resumes.",
            "Submit a signed cover letter.",
            "SECTION M - EVALUATION FACTORS",
            "Technical merit is significantly more important than price.",
            "SECTION C - PERFORMANCE WORK STATEMENT",
            "The contractor shall protect CUI using NIST controls.",
            "The contractor shall deliver a monthly status report.",
            "The contractor shall complete transition within 30 days.",
            "The contractor shall provide key personnel.",
            "The contractor shall grant technical data rights.",
            "The contractor shall provide firm-fixed pricing.",
            "The offeror shall certify its OCI representation.",
            "DFARS 252.204-7012 shall apply.",
            "The contractor shall provide",
            "a transition plan with named owners.",
        )
    )
    text = "[PDF Page 7]\n" + "\n".join(section_text)
    seed_extracted_document(client, str(project["id"]), text)

    response = _extract(client, str(project["id"]))
    assert response.status_code == 200, response.text
    requirements = _requirements(client, str(project["id"])).json()
    assert set(string.ascii_uppercase[:13]).issubset(
        {requirement["section"] for requirement in requirements}
    )
    assert {
        "SUBMISSION_INSTRUCTION",
        "EVALUATION_FACTOR",
        "SECURITY",
        "DELIVERABLE",
        "SCHEDULE",
        "STAFFING",
        "DATA_RIGHTS",
        "PRICING",
        "REPRESENTATION",
        "CLAUSE",
    }.issubset({requirement["category"] for requirement in requirements})

    split = [
        requirement
        for requirement in requirements
        if "twelve-point" in requirement["source_text"]
        or "include resumes" in requirement["source_text"]
    ]
    assert len(split) == 2
    imperative = next(
        requirement
        for requirement in requirements
        if "signed cover letter" in requirement["source_text"]
    )
    assert imperative["mandatory_term"] == "SUBMIT"
    relative_importance = next(
        requirement
        for requirement in requirements
        if "significantly more important" in requirement["source_text"]
    )
    assert relative_importance["category"] == "EVALUATION_FACTOR"
    multiline = next(
        requirement
        for requirement in requirements
        if "transition plan with named owners" in requirement["source_text"]
    )
    assert "\n" in multiline["source_text"]
    assert multiline["source_locator"].startswith("PDF Page 7;")
    for requirement in requirements:
        assert (
            text[requirement["source_start"] : requirement["source_end"]]
            == requirement["source_text"]
        )


def test_far_and_dfars_clause_rows_are_distinct_and_idempotent(
    client: TestClient, project: dict[str, object]
) -> None:
    text = (
        "[PDF Page 45]\n"
        "SECTION I - CONTRACT CLAUSES\n"
        "FAR 52.204-7 System for Award Management (OCT 2018)\n"
        "52.212-4 Contract Terms and Conditions. Alternate I\n"
        "DFARS 252.204-7012 Safeguarding Covered Defense Information"
    )
    seed_extracted_document(client, str(project["id"]), text)

    first = _extract(client, str(project["id"]))
    assert first.status_code == 200
    clauses = _requirements(client, str(project["id"]), "?category=CLAUSE").json()
    assert [clause["source_text"] for clause in clauses] == [
        "FAR 52.204-7 System for Award Management (OCT 2018)",
        "52.212-4 Contract Terms and Conditions. Alternate I",
        "DFARS 252.204-7012 Safeguarding Covered Defense Information",
    ]
    assert all(clause["section"] == "I" for clause in clauses)
    assert all(
        text[clause["source_start"] : clause["source_end"]] == clause["source_text"]
        for clause in clauses
    )

    second = _extract(client, str(project["id"])).json()
    assert second["requirements_created"] == 0
    assert second["requirements_reused"] == 3
    assert len(_requirements(client, str(project["id"]), "?category=CLAUSE").json()) == 3


def test_cdrl_all_fields_multiline_tailoring_and_section_boundary(
    client: TestClient, project: dict[str, object]
) -> None:
    text = (
        "[DOCX Paragraph 1]\n"
        + _full_cdrl()
        + "\nSECTION M - EVALUATION FACTORS\n"
        + "Technical approach will be evaluated for risk."
    )
    seed_extracted_document(client, str(project["id"]), text, name="exhibit-a.pdf")

    summary = _extract(client, str(project["id"]))
    assert summary.status_code == 200
    assert summary.json()["cdrls_created"] == 1
    cdrl = client.get(f"/api/projects/{project['id']}/cdrls").json()[0]
    assert cdrl["block_a"] == "0001"
    assert cdrl["block_1"] == "A001"
    assert cdrl["block_14"] == ("Draft copies: 01\nFinal copies: 02\nDestination: AFLCMC")
    assert cdrl["block_15"] == "003"
    assert cdrl["block_16"] == ("Tailor paragraph 10.2.\nRetain all tables and source references.")
    assert cdrl["block_18"] == "$000000"
    assert cdrl["incomplete"] is False
    assert cdrl["incomplete_fields"] == []
    assert "SECTION M" not in cdrl["source_text"]
    assert text[cdrl["source_start"] : cdrl["source_end"]] == cdrl["source_text"]

    linked = next(
        requirement
        for requirement in _requirements(client, str(project["id"])).json()
        if requirement["id"] == cdrl["requirement_id"]
    )
    assert linked["category"] == "CDRL"


def test_partial_cdrl_keeps_nulls_leading_zeros_and_multiline_remarks(
    client: TestClient, project: dict[str, object]
) -> None:
    text = (
        "DD FORM 1423\n"
        "1. DATA ITEM NO.: 0007\n"
        "14. DISTRIBUTION: Draft 01\nFinal 02\n"
        "16. REMARKS: First line\nSecond line"
    )
    seed_extracted_document(client, str(project["id"]), text)
    assert _extract(client, str(project["id"])).status_code == 200
    cdrl = client.get(f"/api/projects/{project['id']}/cdrls").json()[0]
    assert cdrl["block_1"] == "0007"
    assert cdrl["block_2"] is None
    assert cdrl["block_14"] == "Draft 01\nFinal 02"
    assert cdrl["block_16"] == "First line\nSecond line"
    assert cdrl["incomplete"] is True
    assert "block_2_title" in cdrl["incomplete_fields"]


def test_footer_ordered_cdrl_includes_preceding_fields_and_stops_at_footer(
    client: TestClient, project: dict[str, object]
) -> None:
    text = (
        "[PDF Page 62]\n"
        "SECTION J - ATTACHMENTS\n"
        "CONTRACT DATA REQUIREMENTS LIST\n"
        "(1 Data Item)\n"
        "1. DATA ITEM NO.\nA001\n"
        "2. TITLE OF DATA ITEM\nTASK ORDER MANAGEMENT PLAN\n"
        "4. AUTHORITY (DATA ACQUISITION DOCUMENT NO.)\nDI-MGMT-80004A\n"
        "16. REMARKS\nSubmit within five days of task-order award.\n"
        "DD FORM 1423-1, FEB 2001 PREVIOUS EDITION MAY BE USED. Page 1 of 1 Pages\n"
        "This unrelated attachment text must not become Block 16.\n"
        "SECTION M - EVALUATION FACTORS\nTechnical merit is important."
    )
    seed_extracted_document(client, str(project["id"]), text, name="filled-dd1423.pdf")

    summary = _extract(client, str(project["id"])).json()
    assert summary["cdrls_created"] == 1
    cdrl = client.get(f"/api/projects/{project['id']}/cdrls").json()[0]
    assert cdrl["block_1"] == "A001"
    assert cdrl["block_2"] == "TASK ORDER MANAGEMENT PLAN"
    assert cdrl["block_4"] == "DI-MGMT-80004A"
    assert cdrl["block_16"] == "Submit within five days of task-order award."
    assert cdrl["source_text"].startswith("CONTRACT DATA REQUIREMENTS LIST")
    assert cdrl["source_text"].endswith("Page 1 of 1 Pages")
    assert "unrelated attachment" not in cdrl["source_text"]
    assert cdrl["source_truncated"] is False
    assert len(cdrl["source_text"]) <= MAX_CDRL_SOURCE_CHARACTERS
    assert text[cdrl["source_start"] : cdrl["source_end"]] == cdrl["source_text"]


def test_multiple_tab_fields_are_independent_and_blank_header_labels_stay_null(
    client: TestClient, project: dict[str, object]
) -> None:
    text = (
        '[XLSX Sheet "CDRL" Row 1]\nDD FORM 1423\n'
        '[XLSX Sheet "CDRL" Row 2]\n'
        "A. CONTRACT LINE ITEM NO. B. EXHIBIT C. CATEGORY:\n"
        '[XLSX Sheet "CDRL" Row 3]\n'
        "Block 1\t0007\tBlock 2\tSTATUS REPORT\tBlock 4\tDI-MGMT-80368\n"
        '[XLSX Sheet "CDRL" Row 4]\n'
        "Block 10\tMTHLY\tBlock 16\tRetain the source wording."
    )
    seed_extracted_document(
        client,
        str(project["id"]),
        text,
        name="tabular-cdrl.xlsx",
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )

    assert _extract(client, str(project["id"])).status_code == 200
    cdrl = client.get(f"/api/projects/{project['id']}/cdrls").json()[0]
    assert cdrl["block_a"] is None
    assert cdrl["block_b"] is None
    assert cdrl["block_c"] is None
    assert cdrl["block_1"] == "0007"
    assert cdrl["block_2"] == "STATUS REPORT"
    assert cdrl["block_4"] == "DI-MGMT-80368"
    assert cdrl["block_10"] == "MTHLY"
    assert cdrl["block_16"] == "Retain the source wording."
    assert "Block 2" not in cdrl["block_1"]
    assert text[cdrl["source_start"] : cdrl["source_end"]] == cdrl["source_text"]


def test_tabular_cdrl_fields_and_oversized_source_are_bounded(
    client: TestClient, project: dict[str, object]
) -> None:
    text = (
        '[XLSX Sheet "CDRL" Row 1]\nDD FORM 1423\n'
        '[XLSX Sheet "CDRL" Row 2]\nBlock 1\t0007\n'
        '[XLSX Sheet "CDRL" Row 3]\nBlock 2\tSTATUS REPORT\n'
        '[XLSX Sheet "CDRL" Row 4]\nBlock 16\tPreserve tailoring.\n'
        + ("X" * (MAX_CDRL_SOURCE_CHARACTERS * 2))
    )
    seed_extracted_document(
        client,
        str(project["id"]),
        text,
        name="cdrl.xlsx",
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )

    assert _extract(client, str(project["id"])).status_code == 200
    cdrl = client.get(f"/api/projects/{project['id']}/cdrls").json()[0]
    assert cdrl["block_1"] == "0007"
    assert cdrl["block_2"] == "STATUS REPORT"
    assert cdrl["block_16"].startswith("Preserve tailoring.")
    assert cdrl["source_truncated"] is True
    assert cdrl["incomplete"] is True
    assert len(cdrl["source_text"]) <= MAX_CDRL_SOURCE_CHARACTERS


def test_idempotent_rerun_preserves_edit_and_append_only_review(
    client: TestClient, project: dict[str, object]
) -> None:
    text = "SECTION L - INSTRUCTIONS\nThe offeror shall submit Volume I."
    seed_extracted_document(client, str(project["id"]), text)
    first_summary = _extract(client, str(project["id"])).json()
    requirement = _requirements(client, str(project["id"])).json()[0]
    source_before = requirement["source_text"]
    fingerprint_before = requirement["fingerprint"]

    patch = client.patch(
        f"/api/projects/{project['id']}/requirements/{requirement['id']}",
        json={
            "requirement_text": "Submit the technical Volume I package.",
            "validation_status": "VALIDATED",
            "reviewer": "Alex Reviewer",
            "review_note": "Confirmed against Section L.",
            "expected_updated_at": requirement["updated_at"],
        },
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["source_text"] == source_before

    second_summary = _extract(client, str(project["id"])).json()
    assert first_summary["requirements_created"] == 1
    assert second_summary["requirements_created"] == 0
    assert second_summary["requirements_reused"] == 1
    rerun = _requirements(client, str(project["id"])).json()[0]
    assert rerun["id"] == requirement["id"]
    assert rerun["fingerprint"] == fingerprint_before
    assert rerun["requirement_text"] == "Submit the technical Volume I package."
    assert rerun["validation_status"] == "VALIDATED"
    reviews = client.get(
        f"/api/projects/{project['id']}/requirements/{requirement['id']}/reviews"
    ).json()
    assert len(reviews) == 1
    assert reviews[0]["reviewer"] == "Alex Reviewer"
    assert reviews[0]["previous_state"]["validation_status"] == "PENDING"
    assert reviews[0]["new_state"]["validation_status"] == "VALIDATED"


def test_stale_requirement_patch_returns_conflict_without_an_audit_row(
    client: TestClient, project: dict[str, object]
) -> None:
    seed_extracted_document(
        client,
        str(project["id"]),
        "SECTION L - INSTRUCTIONS\nThe offeror shall submit Volume I.",
    )
    _extract(client, str(project["id"]))
    requirement = _requirements(client, str(project["id"])).json()[0]
    url = f"/api/projects/{project['id']}/requirements/{requirement['id']}"
    expected_updated_at = requirement["updated_at"]

    accepted = client.patch(
        url,
        json={
            "validation_status": "VALIDATED",
            "reviewer": "First Reviewer",
            "expected_updated_at": expected_updated_at,
        },
    )
    assert accepted.status_code == 200
    assert accepted.json()["updated_at"] != expected_updated_at

    stale = client.patch(
        url,
        json={
            "validation_status": "DISMISSED",
            "reviewer": "Stale Reviewer",
            "review_note": "This decision must not persist.",
            "expected_updated_at": expected_updated_at,
        },
    )
    assert stale.status_code == 409
    assert "refresh" in stale.text.lower()

    current = _requirements(client, str(project["id"])).json()[0]
    assert current["validation_status"] == "VALIDATED"
    assert current["reviewer"] == "First Reviewer"
    reviews = client.get(f"{url}/reviews").json()
    assert len(reviews) == 1
    assert reviews[0]["reviewer"] == "First Reviewer"


def test_concurrent_requirement_patches_allow_exactly_one_decision(
    client: TestClient,
    project: dict[str, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed_extracted_document(
        client,
        str(project["id"]),
        "SECTION L - INSTRUCTIONS\nThe offeror shall submit Volume I.",
    )
    _extract(client, str(project["id"]))
    requirement = _requirements(client, str(project["id"])).json()[0]
    url = f"/api/projects/{project['id']}/requirements/{requirement['id']}"
    race = threading.Barrier(2)
    original_patch = requirements_api.apply_requirement_patch

    def synchronize_patches(session, current_requirement, patch):  # type: ignore[no-untyped-def]
        race.wait(timeout=5)
        return original_patch(session, current_requirement, patch)

    monkeypatch.setattr(requirements_api, "apply_requirement_patch", synchronize_patches)
    common = {"expected_updated_at": requirement["updated_at"]}
    payloads = [
        common | {"validation_status": "VALIDATED", "reviewer": "Reviewer One"},
        common
        | {
            "validation_status": "DISMISSED",
            "reviewer": "Reviewer Two",
            "review_note": "Concurrent decision.",
        },
    ]
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda payload: client.patch(url, json=payload), payloads))

    assert sorted(response.status_code for response in responses) == [200, 409]
    reviews = client.get(f"{url}/reviews").json()
    assert len(reviews) == 1
    current = _requirements(client, str(project["id"])).json()[0]
    assert current["reviewer"] == reviews[0]["reviewer"]
    assert current["validation_status"] == reviews[0]["new_state"]["validation_status"]


def test_concurrent_extraction_is_idempotent_and_atomic(
    client: TestClient,
    project: dict[str, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed_extracted_document(
        client,
        str(project["id"]),
        _full_cdrl()
        + "\nSECTION C - PERFORMANCE WORK STATEMENT\n"
        + "The contractor shall deliver a monthly status report.",
    )
    original_analyze = requirements_service.analyze_document
    race = threading.Barrier(2)
    call_lock = threading.Lock()
    calls = 0

    def synchronize_first_attempts(document, **limits):  # type: ignore[no-untyped-def]
        nonlocal calls
        with call_lock:
            calls += 1
            call_number = calls
        if call_number <= 2:
            race.wait(timeout=5)
        return original_analyze(document, **limits)

    monkeypatch.setattr(
        requirements_service,
        "analyze_document",
        synchronize_first_attempts,
    )
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(_extract, client, str(project["id"])) for _ in range(2)]
        responses = [future.result(timeout=10) for future in futures]

    assert [response.status_code for response in responses] == [200, 200]
    requirements = _requirements(client, str(project["id"])).json()
    cdrls = client.get(f"/api/projects/{project['id']}/cdrls").json()
    assert len({item["fingerprint"] for item in requirements}) == len(requirements)
    assert len(requirements) == 2
    assert len(cdrls) == 1
    assert cdrls[0]["requirement_id"] in {item["id"] for item in requirements}


def test_patch_validation_audit_and_cdrl_review_sync(
    client: TestClient, project: dict[str, object]
) -> None:
    seed_extracted_document(client, str(project["id"]), _full_cdrl())
    _extract(client, str(project["id"]))
    cdrl = client.get(f"/api/projects/{project['id']}/cdrls").json()[0]
    url = f"/api/projects/{project['id']}/requirements/{cdrl['requirement_id']}"
    requirement = next(
        item
        for item in _requirements(client, str(project["id"])).json()
        if item["id"] == cdrl["requirement_id"]
    )

    assert client.patch(url, json={"section": "J"}).status_code == 422
    null_field = client.patch(
        url,
        json={
            "section": None,
            "reviewer": "Contracts Lead",
            "expected_updated_at": requirement["updated_at"],
        },
    )
    assert null_field.status_code == 422
    assert "cannot be null" in null_field.text
    assert (
        client.patch(
            url,
            json={"section": "J", "reviewer": "", "source_text": "overwrite"},
        ).status_code
        == 422
    )
    dismissed = client.patch(
        url,
        json={
            "validation_status": "DISMISSED",
            "reviewer": "Contracts Lead",
            "review_note": "Not applicable to this CLIN.",
            "expected_updated_at": requirement["updated_at"],
        },
    )
    assert dismissed.status_code == 200
    assert dismissed.json()["dismissal_reason"] == "Not applicable to this CLIN."
    synced = client.get(f"/api/projects/{project['id']}/cdrls").json()[0]
    assert synced["validation_status"] == "DISMISSED"
    assert synced["reviewer"] == "Contracts Lead"
    assert synced["reviewed_at"] is not None


def test_filters_project_isolation_and_document_validation(
    client: TestClient, project: dict[str, object]
) -> None:
    document_id = seed_extracted_document(
        client,
        str(project["id"]),
        "SECTION L - INSTRUCTIONS\nThe offeror shall submit a proposal.\n"
        "SECTION C - PWS\nThe contractor shall protect CUI.",
    )
    other_project = client.post("/api/projects", json={"name": "Other"}).json()
    other_document_id = seed_extracted_document(
        client,
        other_project["id"],
        "SECTION M - EVALUATION\nPrice will be evaluated.",
    )
    _extract(client, str(project["id"]))
    _extract(client, other_project["id"])

    section_l = _requirements(client, str(project["id"]), "?section=L").json()
    assert section_l and all(item["section"] == "L" for item in section_l)
    security = _requirements(client, str(project["id"]), "?category=SECURITY").json()
    assert len(security) == 1
    by_document = _requirements(client, str(project["id"]), f"?document_id={document_id}")
    assert by_document.status_code == 200
    assert (
        _requirements(client, str(project["id"]), f"?document_id={other_document_id}").status_code
        == 404
    )

    foreign_requirement = _requirements(client, other_project["id"]).json()[0]
    foreign_url = f"/api/projects/{project['id']}/requirements/{foreign_requirement['id']}"
    assert (
        client.patch(
            foreign_url,
            json={
                "section": "M",
                "reviewer": "Reviewer",
                "expected_updated_at": foreign_requirement["updated_at"],
            },
        ).status_code
        == 404
    )
    assert client.get(f"{foreign_url}/reviews").status_code == 404


def test_duplicates_scans_and_errors_are_not_analyzed(
    client: TestClient, project: dict[str, object]
) -> None:
    text = "SECTION C - PWS\nThe contractor shall provide a report."
    original_id = seed_extracted_document(client, str(project["id"]), text)
    seed_extracted_document(
        client,
        str(project["id"]),
        text,
        name="duplicate.pdf",
        duplicate_of=original_id,
    )
    seed_extracted_document(
        client,
        str(project["id"]),
        "unavailable",
        name="scan.pdf",
        status=DocumentStatus.NEEDS_OCR,
    )
    seed_extracted_document(
        client,
        str(project["id"]),
        "parser error",
        name="error.pdf",
        status=DocumentStatus.ERROR,
    )
    summary = _extract(client, str(project["id"])).json()
    assert summary["documents_analyzed"] == 1
    assert summary["requirements_created"] == 1


def test_no_network_hostile_text_and_transactional_rollback(
    client: TestClient,
    project: dict[str, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hostile = "x" * 50_000 + " The contractor shall submit a safe report."
    seed_extracted_document(client, str(project["id"]), hostile, name="one.pdf")

    def blocked(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket, "create_connection", blocked)
    monkeypatch.setattr(socket, "getaddrinfo", blocked)
    response = _extract(client, str(project["id"]))
    assert response.status_code == 200
    assert response.json()["requirements_created"] == 1
    hostile_requirements = _requirements(client, str(project["id"])).json()
    assert all(len(item["source_text"]) <= 8_000 for item in hostile_requirements)
    fingerprints = [item["fingerprint"] for item in hostile_requirements]
    assert _extract(client, str(project["id"])).json()["requirements_created"] == 0
    assert [
        item["fingerprint"] for item in _requirements(client, str(project["id"])).json()
    ] == fingerprints

    second_project = client.post("/api/projects", json={"name": "Rollback"}).json()
    seed_extracted_document(
        client,
        second_project["id"],
        "The contractor shall provide item one.",
        name="a.pdf",
    )
    seed_extracted_document(
        client,
        second_project["id"],
        "The contractor shall provide item two.",
        name="b.pdf",
    )
    original_analyze = requirements_service.analyze_document
    calls = 0

    def fail_second(document, **limits):  # type: ignore[no-untyped-def]
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("synthetic failure")
        return original_analyze(document, **limits)

    monkeypatch.setattr(requirements_service, "analyze_document", fail_second)
    with pytest.raises(RuntimeError, match="synthetic failure"):
        _extract(client, second_project["id"])
    assert _requirements(client, second_project["id"]).json() == []


def test_per_document_requirement_cap_is_atomic(app_factory) -> None:  # type: ignore[no-untyped-def]
    app = app_factory(
        max_requirement_candidates_per_document=2,
        max_requirement_candidates_per_run=20,
        max_cdrl_candidates_per_document=10,
        max_cdrl_candidates_per_run=20,
    )
    with make_test_client(app) as client:
        project = _create_project(client)
        project_id = str(project["id"])
        seed_extracted_document(
            client,
            project_id,
            "SECTION C - PWS\nThe contractor shall provide the safe item.",
            name="a-safe.pdf",
        )
        seed_extracted_document(
            client,
            project_id,
            "SECTION C - PWS\n"
            "The contractor shall provide item one.\n"
            "The contractor shall provide item two.\n"
            "The contractor shall provide item three.",
            name="b-over-limit.pdf",
        )

        response = _extract(client, project_id)

        assert response.status_code == 413
        assert response.json() == {
            "detail": (
                "Requirement extraction exceeded the per-document safety limit of 2 candidates."
            )
        }
        _assert_empty_registers(client, project_id)


def test_per_document_cdrl_cap_is_atomic(app_factory) -> None:  # type: ignore[no-untyped-def]
    app = app_factory(
        max_requirement_candidates_per_document=20,
        max_requirement_candidates_per_run=20,
        max_cdrl_candidates_per_document=1,
        max_cdrl_candidates_per_run=20,
    )
    with make_test_client(app) as client:
        project_id = str(_create_project(client)["id"])
        second_cdrl = _full_cdrl().replace("A001", "A002", 1)
        seed_extracted_document(client, project_id, f"{_full_cdrl()}\n{second_cdrl}")

        response = _extract(client, project_id)

        assert response.status_code == 413
        assert "CDRL extraction exceeded the per-document safety limit" in response.text
        _assert_empty_registers(client, project_id)


def test_per_run_requirement_cap_is_atomic_across_documents(
    app_factory,
) -> None:  # type: ignore[no-untyped-def]
    app = app_factory(
        max_requirement_candidates_per_document=2,
        max_requirement_candidates_per_run=2,
        max_cdrl_candidates_per_document=10,
        max_cdrl_candidates_per_run=20,
    )
    with make_test_client(app) as client:
        project_id = str(_create_project(client)["id"])
        seed_extracted_document(
            client,
            project_id,
            "The contractor shall provide the first item.",
            name="a.pdf",
        )
        seed_extracted_document(
            client,
            project_id,
            "The contractor shall provide the second item.\n"
            "The contractor shall provide the third item.",
            name="b.pdf",
        )

        response = _extract(client, project_id)

        assert response.status_code == 413
        assert "Requirement extraction exceeded the per-run safety limit" in response.text
        _assert_empty_registers(client, project_id)


def test_per_run_cdrl_cap_is_atomic_across_documents(
    app_factory,
) -> None:  # type: ignore[no-untyped-def]
    app = app_factory(
        max_requirement_candidates_per_document=20,
        max_requirement_candidates_per_run=20,
        max_cdrl_candidates_per_document=2,
        max_cdrl_candidates_per_run=1,
    )
    with make_test_client(app) as client:
        project_id = str(_create_project(client)["id"])
        seed_extracted_document(client, project_id, _full_cdrl(), name="a.pdf")
        seed_extracted_document(
            client,
            project_id,
            _full_cdrl().replace("A001", "A002", 1),
            name="b.pdf",
        )

        response = _extract(client, project_id)

        assert response.status_code == 413
        assert "CDRL extraction exceeded the per-run safety limit" in response.text
        _assert_empty_registers(client, project_id)


def test_cdrl_marker_flood_is_bounded_before_record_scanning(
    app_factory,
) -> None:  # type: ignore[no-untyped-def]
    app = app_factory(
        max_requirement_candidates_per_document=20,
        max_requirement_candidates_per_run=20,
        max_cdrl_candidates_per_document=1,
        max_cdrl_candidates_per_run=20,
    )
    with make_test_client(app) as client:
        project_id = str(_create_project(client)["id"])
        seed_extracted_document(client, project_id, "\n".join(["DD FORM 1423"] * 41))

        response = _extract(client, project_id)

        assert response.status_code == 413
        assert "CDRL extraction exceeded the per-document safety limit" in response.text
        _assert_empty_registers(client, project_id)
