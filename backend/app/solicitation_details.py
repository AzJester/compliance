from __future__ import annotations

import hashlib
import json
import re
from bisect import bisect_right
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .database import get_session
from .models import (
    Document,
    DocumentClassification,
    DocumentProfile,
    DocumentStatus,
    Project,
    SolicitationAnalysisRun,
    SolicitationCandidate,
    SolicitationDecision,
    SolicitationField,
    SolicitationProfile,
    utc_now,
)
from .schemas import (
    ProjectResponse,
    SolicitationAnalysisResponse,
    SolicitationApplyRequest,
    SolicitationApplyResponse,
    SolicitationCandidateResponse,
    SolicitationDecisionResponse,
    SolicitationFieldResponse,
    SolicitationProfileResponse,
)

router = APIRouter(prefix="/api/projects/{project_id}", tags=["solicitation details"])

RULE_VERSION = "solicitation-details-1.0"
_INPUT_CLASSIFICATIONS = {
    DocumentClassification.BASE_SOLICITATION,
    DocumentClassification.AMENDMENT,
}
_FIELD_ORDER = tuple(SolicitationField)
_FIELD_LABELS = {
    SolicitationField.TITLE: "Project title",
    SolicitationField.SOLICITATION_NUMBER: "Solicitation number",
    SolicitationField.AGENCY: "Agency / issuing office",
    SolicitationField.DUE_AT: "Proposal due date and time",
    SolicitationField.NAICS_CODE: "NAICS code",
    SolicitationField.PSC_CODE: "Product service code",
    SolicitationField.SET_ASIDE: "Set-aside",
    SolicitationField.CONTRACT_TYPE: "Contract type",
    SolicitationField.POINTS_OF_CONTACT: "Points of contact",
}
_MAX_CANDIDATES_PER_FIELD_PER_DOCUMENT = 50
_MAX_CANDIDATES_PER_RUN = 500
_MAX_EVIDENCE_CHARACTERS = 2_000
_MARKER_PATTERN = re.compile(
    r"(?m)^\[(?P<marker>PDF Page (?P<pdf_page>\d+)|Slide (?P<slide>\d+)|"
    r"DOCX (?:Paragraph|Table)[^\]]*|XLSX Sheet [^\]]*)\]\s*$"
)
_EXPLICIT_CHANGE_PATTERN = re.compile(
    r"\b(?:is hereby changed|is amended to read|is revised to|is extended to|"
    r"receipt of (?:proposals?|offers?|quotations?) is extended|replace(?:d)? with|"
    r"delete(?:d)?\b.{0,100}\b(?:insert|substitute)|new (?:closing|proposal|offer|response) "
    r"(?:date|deadline))\b",
    re.IGNORECASE | re.DOTALL,
)
_AMENDMENT_NUMBER_PATTERN = re.compile(
    r"\b(?:amendment(?:/modification)?(?:\s+(?:no\.?|number))?|amend\.?)"
    r"\s*[:#-]?\s*0*(?P<number>\d{1,4})\b",
    re.IGNORECASE,
)
_EMAIL_PATTERN = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)
_PHONE_PATTERN = re.compile(
    r"(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?",
    re.IGNORECASE,
)
_CONTACT_ROLE_PATTERN = re.compile(
    r"\b(?P<role>primary point of contact|secondary point of contact|points? of contact|"
    r"POC|contract specialist|contracting officer|contracting officer representative)\b",
    re.IGNORECASE,
)
_DUE_LABEL_PATTERN = re.compile(
    r"(?:\b(?:proposal responses?|proposals?|offers?|quotations?|quotes?|responses to this "
    r"solicitation)\s+(?:are\s+)?(?:due|must be received|shall be received)\b|"
    r"\b(?:proposal|offer|quotation|response)\s+due\s+(?:date(?:\s+and\s+time)?|deadline)\b|"
    r"\breceipt of (?:proposals?|offers?|quotations?)\s+(?:is\s+)?"
    r"(?:due|required by|extended to)\b|\bdate offers? due\b|\bclosing date and time\b|"
    r"^\s*response date(?: and time)?\s*[:#-])",
    re.IGNORECASE,
)
_DATE_PATTERN = re.compile(
    r"(?P<date>(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
    r"\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|"
    r"Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|"
    r"Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-](?:\d{2}|\d{4})|"
    r"\d{4}-\d{2}-\d{2})",
    re.IGNORECASE,
)
_TIME_PATTERN = re.compile(
    r"(?<!\d)(?P<hour>\d{1,2}):(?P<minute>\d{2})\s*"
    r"(?P<ampm>[AP]\.?M\.?)?|(?<!\d)(?P<military>[012]\d[0-5]\d)\s*"
    r"(?:hours?|hrs?)\b",
    re.IGNORECASE,
)
_TIMEZONE_PATTERN = re.compile(
    r"\b(?P<timezone>UTC|GMT|ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT|"
    r"Eastern(?: Standard| Daylight)? Time|Central(?: Standard| Daylight)? Time|"
    r"Mountain(?: Standard| Daylight)? Time|Pacific(?: Standard| Daylight)? Time|"
    r"Arizona Time|Alaska(?: Standard| Daylight)? Time|Hawaii(?: Standard)? Time|"
    r"local time)\b",
    re.IGNORECASE,
)
_TIMEZONES = {
    "utc": "UTC",
    "gmt": "UTC",
    "et": "America/New_York",
    "est": "Etc/GMT+5",
    "edt": "Etc/GMT+4",
    "eastern time": "America/New_York",
    "eastern standard time": "Etc/GMT+5",
    "eastern daylight time": "Etc/GMT+4",
    "ct": "America/Chicago",
    "cst": "Etc/GMT+6",
    "cdt": "Etc/GMT+5",
    "central time": "America/Chicago",
    "central standard time": "Etc/GMT+6",
    "central daylight time": "Etc/GMT+5",
    "mt": "America/Denver",
    "mst": "Etc/GMT+7",
    "mdt": "Etc/GMT+6",
    "mountain time": "America/Denver",
    "mountain standard time": "Etc/GMT+7",
    "mountain daylight time": "Etc/GMT+6",
    "arizona time": "America/Phoenix",
    "pt": "America/Los_Angeles",
    "pst": "Etc/GMT+8",
    "pdt": "Etc/GMT+7",
    "pacific time": "America/Los_Angeles",
    "pacific standard time": "Etc/GMT+8",
    "pacific daylight time": "Etc/GMT+7",
    "alaska standard time": "Etc/GMT+9",
    "alaska daylight time": "Etc/GMT+8",
    "hawaii time": "Pacific/Honolulu",
    "hawaii standard time": "Pacific/Honolulu",
}


@dataclass(frozen=True, slots=True)
class _Detected:
    field_key: SolicitationField
    value: str
    normalized_value: dict[str, Any]
    source_start: int
    source_end: int
    excerpt: str
    confidence: float
    rationale: str
    pattern: str
    applicable: bool = True
    needs_input: str | None = None


def _project(session: Session, project_id: str) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


def _profile(session: Session, project_id: str) -> SolicitationProfile:
    profile = session.get(SolicitationProfile, project_id)
    if profile is None:
        raise HTTPException(status_code=500, detail="Solicitation profile is unavailable.")
    return profile


def _input_documents(session: Session, project_id: str) -> list[Document]:
    return list(
        session.scalars(
            select(Document)
            .join(DocumentProfile, DocumentProfile.document_id == Document.id)
            .options(selectinload(Document.workflow_profile))
            .where(
                Document.project_id == project_id,
                DocumentProfile.classification.in_(_INPUT_CLASSIFICATIONS),
            )
            .order_by(Document.id)
        )
    )


def _input_fingerprint(documents: list[Document]) -> str:
    payload = {
        "rule_version": RULE_VERSION,
        "documents": [
            {
                "id": document.id,
                "name": document.name,
                "blob_sha256": document.blob_sha256,
                "text_sha256": hashlib.sha256(document.extracted_text.encode("utf-8")).hexdigest(),
                "classification": document.classification.value,
                "status": document.status.value,
                "duplicate_of": document.duplicate_of,
            }
            for document in documents
        ],
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _amendment_number(document: Document) -> int | None:
    searchable = f"{document.name}\n{document.extracted_text[:8_000]}"
    matches = [
        int(match.group("number")) for match in _AMENDMENT_NUMBER_PATTERN.finditer(searchable)
    ]
    if not matches:
        return None
    unique = set(matches)
    return matches[0] if len(unique) == 1 else None


def _source_markers(text: str) -> list[tuple[int, str, int | None]]:
    markers: list[tuple[int, str, int | None]] = []
    for marker in _MARKER_PATTERN.finditer(text):
        page_text = marker.group("pdf_page") or marker.group("slide")
        markers.append(
            (
                marker.start(),
                marker.group("marker"),
                int(page_text) if page_text else None,
            )
        )
    return markers


def _source_locator(
    markers: list[tuple[int, str, int | None]], start: int, end: int
) -> tuple[str, int | None]:
    marker_index = bisect_right(markers, (start, "\uffff", None)) - 1
    if marker_index < 0:
        return f"Characters {start}-{end}", None
    _, marker_label, page_number = markers[marker_index]
    return f"{marker_label}; characters {start}-{end}", page_number


def _confidence_level(confidence: float) -> str:
    if confidence >= 0.85:
        return "HIGH"
    if confidence >= 0.65:
        return "MEDIUM"
    return "LOW"


def _canonical(value: dict[str, Any]) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).casefold()


def _semantic_canonical(field_key: SolicitationField, normalized_value: dict[str, Any]) -> str:
    if field_key == SolicitationField.DUE_AT:
        semantic = {
            key: normalized_value.get(key)
            for key in ("due_at", "due_timezone", "local_datetime")
            if normalized_value.get(key) is not None
        }
    elif field_key == SolicitationField.POINTS_OF_CONTACT:
        semantic = normalized_value
    else:
        semantic = {
            key: value for key, value in normalized_value.items() if key not in {"source_timezone"}
        }
    return _canonical(semantic)


def _clean_value(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip(" \t:;,-")


def _labeled_matches(
    text: str,
    *,
    labels: str,
    value_pattern: str,
    field_key: SolicitationField,
    confidence: float,
    rationale: str,
    pattern_name: str,
    normalizer: Any,
) -> list[_Detected]:
    same_line = re.compile(
        rf"(?im)^[ \t]*(?:{labels})(?:[ \t]*[:#-][ \t]*|[ \t]+)"
        rf"(?P<value>{value_pattern})[ \t]*$"
    )
    next_line = re.compile(
        rf"(?im)^[ \t]*(?:{labels})[ \t]*:?[ \t]*\r?\n"
        rf"(?P<value>(?![ \t]*\[){value_pattern})[ \t]*$"
    )
    output: list[_Detected] = []
    for pattern in (same_line, next_line):
        for match in pattern.finditer(text):
            raw = _clean_value(match.group("value"))
            normalized = normalizer(raw)
            if normalized is None:
                continue
            start, end = match.span()
            output.append(
                _Detected(
                    field_key=field_key,
                    value=raw,
                    normalized_value=normalized,
                    source_start=start,
                    source_end=end,
                    excerpt=text[start:end],
                    confidence=confidence,
                    rationale=rationale,
                    pattern=pattern_name,
                )
            )
            if len(output) > _MAX_CANDIDATES_PER_FIELD_PER_DOCUMENT:
                raise HTTPException(
                    status_code=413,
                    detail="Solicitation-detail detection exceeded the per-field safety limit.",
                )
    return output


def _string_normalizer(key: str, *, max_length: int) -> Any:
    def normalize(raw: str) -> dict[str, str] | None:
        if not raw or len(raw) > max_length:
            return None
        return {key: raw}

    return normalize


def _code_normalizer(key: str, pattern: str) -> Any:
    compiled = re.compile(pattern, re.IGNORECASE)

    def normalize(raw: str) -> dict[str, str] | None:
        match = compiled.fullmatch(raw.strip())
        if match is None:
            return None
        return {key: match.group(0).replace("-", "").upper()}

    return normalize


def _basic_candidates(text: str) -> list[_Detected]:
    candidates: list[_Detected] = []
    candidates.extend(
        _labeled_matches(
            text,
            labels=r"(?:project |solicitation |requirement )?title|subject",
            value_pattern=r"[^\r\n]{3,250}",
            field_key=SolicitationField.TITLE,
            confidence=0.9,
            rationale="A value followed an explicit solicitation title or subject label.",
            pattern_name="labeled-title",
            normalizer=_string_normalizer("title", max_length=250),
        )
    )
    candidates.extend(
        _labeled_matches(
            text,
            labels=r"solicitation(?:/contract/order)? (?:number|no\.?)|notice id",
            value_pattern=r"[A-Z0-9][A-Z0-9._/-]{4,149}",
            field_key=SolicitationField.SOLICITATION_NUMBER,
            confidence=0.97,
            rationale="A procurement identifier followed an explicit solicitation-number label.",
            pattern_name="labeled-solicitation-number",
            normalizer=lambda raw: {"solicitation_number": raw.upper()},
        )
    )

    def agency_normalizer(raw: str) -> dict[str, str] | None:
        if not raw or len(raw) > 250:
            return None
        return {"agency": raw, "issuing_office": raw}

    candidates.extend(
        _labeled_matches(
            text,
            labels=r"issued by|issuing office|contracting office|agency",
            value_pattern=r"[^\r\n]{3,500}",
            field_key=SolicitationField.AGENCY,
            confidence=0.88,
            rationale="An organization followed an explicit issuing-office or agency label.",
            pattern_name="labeled-agency-office",
            normalizer=agency_normalizer,
        )
    )
    candidates.extend(
        _labeled_matches(
            text,
            labels=r"NAICS(?: code)?|North American Industry Classification(?: System)?(?: code)?",
            value_pattern=r"\d{5,6}",
            field_key=SolicitationField.NAICS_CODE,
            confidence=0.98,
            rationale="A five- or six-digit code followed an explicit NAICS label.",
            pattern_name="labeled-naics",
            normalizer=_code_normalizer("naics_code", r"\d{5,6}"),
        )
    )
    candidates.extend(
        _labeled_matches(
            text,
            labels=(
                r"PSC(?: code)?|FSC(?: code)?|product(?: or)? service code|"
                r"product service code|Federal Supply Classification(?: code)?"
            ),
            value_pattern=r"[A-Z0-9]{4}",
            field_key=SolicitationField.PSC_CODE,
            confidence=0.97,
            rationale=(
                "A four-character code followed an explicit PSC, FSC, or product-service label."
            ),
            pattern_name="labeled-psc",
            normalizer=_code_normalizer("psc_code", r"[A-Z0-9]{4}"),
        )
    )
    candidates.extend(
        _labeled_matches(
            text,
            labels=r"(?:type of )?set[ -]?aside(?: type)?",
            value_pattern=r"[^\r\n]{2,500}",
            field_key=SolicitationField.SET_ASIDE,
            confidence=0.92,
            rationale="A value followed an explicit set-aside label.",
            pattern_name="labeled-set-aside",
            normalizer=_string_normalizer("set_aside", max_length=500),
        )
    )
    candidates.extend(
        _labeled_matches(
            text,
            labels=r"contract type|type of contract|pricing arrangement",
            value_pattern=r"[^\r\n]{2,500}",
            field_key=SolicitationField.CONTRACT_TYPE,
            confidence=0.9,
            rationale="A value followed an explicit contract-type or pricing-arrangement label.",
            pattern_name="labeled-contract-type",
            normalizer=_string_normalizer("contract_type", max_length=500),
        )
    )
    return candidates


def _parse_date(raw: str) -> datetime | None:
    normalized = re.sub(r"\s+", " ", raw.strip()).replace(",", "")
    formats = (
        "%B %d %Y",
        "%b %d %Y",
        "%m/%d/%Y",
        "%m-%d-%Y",
        "%m/%d/%y",
        "%m-%d-%y",
        "%Y-%m-%d",
        "%d %B %Y",
        "%d %b %Y",
    )
    for date_format in formats:
        try:
            return datetime.strptime(normalized, date_format)
        except ValueError:
            continue
    return None


def _parse_due(evidence: str) -> tuple[str, dict[str, Any], bool, str | None] | None:
    date_match = _DATE_PATTERN.search(evidence)
    if date_match is None:
        return None
    date_value = _parse_date(date_match.group("date"))
    if date_value is None:
        return None
    time_match = _TIME_PATTERN.search(evidence)
    if time_match is None:
        return None
    if time_match.group("military"):
        military = time_match.group("military")
        hour, minute = int(military[:2]), int(military[2:])
    else:
        hour, minute = int(time_match.group("hour")), int(time_match.group("minute"))
        ampm = re.sub(r"\W", "", time_match.group("ampm") or "").upper()
        if ampm:
            if not 1 <= hour <= 12:
                return None
            if ampm == "PM" and hour != 12:
                hour += 12
            elif ampm == "AM" and hour == 12:
                hour = 0
        elif hour > 23:
            return None
    local = date_value.replace(hour=hour, minute=minute)
    timezone_match = _TIMEZONE_PATTERN.search(evidence[time_match.end() :])
    display = _clean_value(evidence)
    if timezone_match is None or timezone_match.group("timezone").casefold() == "local time":
        return (
            display,
            {"local_datetime": local.isoformat(timespec="minutes"), "due_timezone": None},
            False,
            "Confirm the solicitation's timezone before this deadline can be applied.",
        )
    timezone_label = re.sub(r"\s+", " ", timezone_match.group("timezone")).casefold()
    zone_name = _TIMEZONES.get(timezone_label)
    if zone_name is None:
        return None
    zone = ZoneInfo(zone_name)
    valid_instants: dict[datetime, datetime] = {}
    for fold in (0, 1):
        possible = local.replace(tzinfo=zone, fold=fold)
        utc_instant = possible.astimezone(UTC)
        round_trip = utc_instant.astimezone(zone).replace(tzinfo=None)
        if round_trip == local:
            valid_instants[utc_instant] = possible
    if len(valid_instants) != 1:
        boundary = "ambiguous" if valid_instants else "nonexistent"
        return (
            display,
            {
                "local_datetime": local.isoformat(timespec="minutes"),
                "due_timezone": zone_name,
                "source_timezone": timezone_match.group("timezone"),
            },
            False,
            (
                f"The detected local deadline is {boundary} at a daylight-saving boundary. "
                "Confirm the intended UTC offset before applying it."
            ),
        )
    aware = next(iter(valid_instants.values()))
    normalized = {
        "due_at": aware.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "due_timezone": zone_name,
        "local_datetime": local.isoformat(timespec="minutes"),
        "source_timezone": timezone_match.group("timezone"),
    }
    return display, normalized, True, None


def _due_candidates(text: str) -> list[_Detected]:
    lines = list(re.finditer(r"(?m)^.*$", text))
    output: list[_Detected] = []
    for index, line_match in enumerate(lines):
        line = line_match.group(0)
        searchable_line = line[:_MAX_EVIDENCE_CHARACTERS]
        if not searchable_line.strip() or _DUE_LABEL_PATTERN.search(searchable_line) is None:
            continue
        if re.search(r"\bquestions?\b", line, re.IGNORECASE):
            continue
        start = line_match.start()
        end = min(line_match.end(), start + _MAX_EVIDENCE_CHARACTERS)
        evidence = text[start:end]
        if (_DATE_PATTERN.search(evidence) is None or _TIME_PATTERN.search(evidence) is None) and (
            index + 1 < len(lines)
        ):
            next_line = lines[index + 1]
            if next_line.group(0).strip() and not next_line.group(0).lstrip().startswith("["):
                end = next_line.end()
                end = min(end, start + _MAX_EVIDENCE_CHARACTERS)
                evidence = text[start:end]
        parsed = _parse_due(evidence)
        if parsed is None:
            continue
        value, normalized, applicable, needs_input = parsed
        output.append(
            _Detected(
                field_key=SolicitationField.DUE_AT,
                value=value,
                normalized_value=normalized,
                source_start=start,
                source_end=end,
                excerpt=evidence,
                confidence=0.97 if applicable else 0.72,
                rationale=(
                    "An explicit offer/proposal receipt deadline supplied date, time, and timezone."
                    if applicable
                    else (
                        "An explicit offer/proposal receipt deadline supplied date and time "
                        "but no defensible timezone."
                    )
                ),
                pattern="offer-receipt-deadline",
                applicable=applicable,
                needs_input=needs_input,
            )
        )
        if len(output) > _MAX_CANDIDATES_PER_FIELD_PER_DOCUMENT:
            raise HTTPException(
                status_code=413,
                detail="Solicitation-detail detection exceeded the deadline safety limit.",
            )
    return output


def _contact_candidates(text: str) -> list[_Detected]:
    lines = list(re.finditer(r"(?m)^.*$", text))
    output: list[_Detected] = []
    for index, line_match in enumerate(lines):
        role_match = _CONTACT_ROLE_PATTERN.search(line_match.group(0)[:_MAX_EVIDENCE_CHARACTERS])
        if role_match is None:
            continue
        end_index = index
        for possible in range(index + 1, min(index + 4, len(lines))):
            candidate_line = lines[possible].group(0)
            if candidate_line.lstrip().startswith("[") or _CONTACT_ROLE_PATTERN.search(
                candidate_line
            ):
                break
            if not candidate_line.strip():
                break
            end_index = possible
        start = line_match.start()
        end = min(lines[end_index].end(), start + _MAX_EVIDENCE_CHARACTERS)
        evidence = text[start:end]
        email_match = _EMAIL_PATTERN.search(evidence)
        phone_match = _PHONE_PATTERN.search(evidence)
        role = _clean_value(role_match.group("role"))
        first_line_tail = line_match.group(0)[role_match.end() :].lstrip(" \t:;-—")
        name = first_line_tail
        if not name and index + 1 <= end_index:
            name = lines[index + 1].group(0).strip()
        if name:
            name = _EMAIL_PATTERN.sub("", name)
            name = _PHONE_PATTERN.sub("", name)
            name = _clean_value(name)
        if name and name.casefold() in {"name", "email", "telephone", "phone"}:
            name = ""
        normalized = {
            key: value
            for key, value in {
                "name": name or None,
                "role": role,
                "email": email_match.group(0).lower() if email_match else None,
                "phone": phone_match.group(0) if phone_match else None,
            }.items()
            if value
        }
        if not normalized.get("name") and not normalized.get("email"):
            continue
        value = str(normalized.get("name") or normalized.get("email"))
        output.append(
            _Detected(
                field_key=SolicitationField.POINTS_OF_CONTACT,
                value=value,
                normalized_value=normalized,
                source_start=start,
                source_end=end,
                excerpt=evidence,
                confidence=0.92 if normalized.get("email") else 0.78,
                rationale="A named procurement contact appeared under an explicit contact role.",
                pattern="labeled-point-of-contact",
            )
        )
        if len(output) > _MAX_CANDIDATES_PER_FIELD_PER_DOCUMENT:
            raise HTTPException(
                status_code=413,
                detail="Solicitation-detail detection exceeded the contact safety limit.",
            )
    return output


def _detect(document: Document) -> list[_Detected]:
    text = document.extracted_text
    return _basic_candidates(text) + _due_candidates(text) + _contact_candidates(text)


def _new_candidate(
    run: SolicitationAnalysisRun,
    document: Document,
    detected: _Detected,
    markers: list[tuple[int, str, int | None]],
) -> SolicitationCandidate:
    locator, page_number = _source_locator(markers, detected.source_start, detected.source_end)
    classification = document.classification
    amendment_number = (
        _amendment_number(document) if classification == DocumentClassification.AMENDMENT else None
    )
    context_start = max(0, detected.source_start - 300)
    context_end = min(len(document.extracted_text), detected.source_end + 150)
    explicit_change = bool(
        classification == DocumentClassification.AMENDMENT
        and _EXPLICIT_CHANGE_PATTERN.search(document.extracted_text[context_start:context_end])
    )
    fingerprint_payload = {
        "field": detected.field_key.value,
        "normalized": detected.normalized_value,
        "document_id": document.id,
        "source_start": detected.source_start,
        "source_end": detected.source_end,
        "rule_version": RULE_VERSION,
    }
    fingerprint = hashlib.sha256(
        json.dumps(fingerprint_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return SolicitationCandidate(
        run=run,
        project_id=document.project_id,
        document_id=document.id,
        field_key=detected.field_key,
        value=detected.value,
        normalized_value=detected.normalized_value,
        document_name=document.name,
        document_sha256=document.blob_sha256,
        document_text_sha256=hashlib.sha256(document.extracted_text.encode("utf-8")).hexdigest(),
        document_classification=classification,
        is_amendment=classification == DocumentClassification.AMENDMENT,
        amendment_number=amendment_number,
        explicit_change=explicit_change,
        source_start=detected.source_start,
        source_end=detected.source_end,
        source_locator=locator,
        page_number=page_number,
        excerpt=detected.excerpt,
        confidence=detected.confidence,
        confidence_level=_confidence_level(detected.confidence),
        detection_rationale=detected.rationale,
        detection_pattern=detected.pattern,
        applicable=detected.applicable,
        needs_input=detected.needs_input,
        candidate_fingerprint=fingerprint,
    )


def _recommendation(candidates: list[SolicitationCandidate], conflict: bool) -> list[str]:
    applicable = [candidate for candidate in candidates if candidate.applicable]
    if not applicable:
        return []
    if candidates[0].field_key == SolicitationField.POINTS_OF_CONTACT:
        best_by_value: dict[str, SolicitationCandidate] = {}
        for candidate in applicable:
            key = _semantic_canonical(candidate.field_key, candidate.normalized_value)
            current = best_by_value.get(key)
            if current is None or (candidate.confidence, candidate.id) > (
                current.confidence,
                current.id,
            ):
                best_by_value[key] = candidate
        return sorted(candidate.id for candidate in best_by_value.values())
    if not conflict:
        best = max(applicable, key=lambda candidate: (candidate.confidence, candidate.id))
        return [best.id]

    amendments = [candidate for candidate in candidates if candidate.is_amendment]
    if not amendments or any(candidate.amendment_number is None for candidate in amendments):
        return []
    highest_number = max(candidate.amendment_number or -1 for candidate in amendments)
    latest = [candidate for candidate in amendments if candidate.amendment_number == highest_number]
    if not latest or any(not candidate.explicit_change for candidate in latest):
        return []
    latest_values = {
        _semantic_canonical(candidate.field_key, candidate.normalized_value) for candidate in latest
    }
    if len(latest_values) != 1:
        return []
    latest_applicable = [candidate for candidate in latest if candidate.applicable]
    if not latest_applicable:
        return []
    best = max(latest_applicable, key=lambda candidate: (candidate.confidence, candidate.id))
    return [best.id]


def _field_response(
    field_key: SolicitationField,
    candidates: list[SolicitationCandidate],
) -> SolicitationFieldResponse:
    candidates = sorted(
        candidates,
        key=lambda candidate: (
            candidate.document_classification != DocumentClassification.BASE_SOLICITATION,
            candidate.amendment_number if candidate.amendment_number is not None else -1,
            candidate.document_name.casefold(),
            candidate.source_start,
            candidate.id,
        ),
    )
    distinct = {
        _semantic_canonical(candidate.field_key, candidate.normalized_value)
        for candidate in candidates
    }
    conflict = field_key != SolicitationField.POINTS_OF_CONTACT and len(distinct) > 1
    recommended_ids = _recommendation(candidates, conflict) if candidates else []
    if not candidates:
        field_status = "NOT_FOUND"
    elif conflict:
        field_status = "CONFLICT"
    elif not any(candidate.applicable for candidate in candidates):
        field_status = "NEEDS_INPUT"
    else:
        field_status = "DETECTED"
    return SolicitationFieldResponse(
        field_key=field_key,
        label=_FIELD_LABELS[field_key],
        repeatable=field_key == SolicitationField.POINTS_OF_CONTACT,
        status=field_status,
        conflict=conflict,
        recommended_candidate_id=recommended_ids[0] if len(recommended_ids) == 1 else None,
        recommended_candidate_ids=recommended_ids,
        candidates=[
            SolicitationCandidateResponse(
                id=candidate.id,
                field_key=candidate.field_key,
                value=candidate.value,
                normalized_value=candidate.normalized_value,
                document_id=candidate.document_id,
                document_name=candidate.document_name,
                document_classification=candidate.document_classification,
                document_sha256=candidate.document_sha256,
                is_amendment=candidate.is_amendment,
                amendment_number=candidate.amendment_number,
                explicit_change=candidate.explicit_change,
                source_start=candidate.source_start,
                source_end=candidate.source_end,
                source_locator=candidate.source_locator,
                page_number=candidate.page_number,
                excerpt=candidate.excerpt,
                confidence=candidate.confidence,
                confidence_level=candidate.confidence_level,
                detection_rationale=candidate.detection_rationale,
                detection_pattern=candidate.detection_pattern,
                applicable=candidate.applicable,
                needs_input=candidate.needs_input,
                recommended=candidate.id in recommended_ids,
                conflict=conflict,
            )
            for candidate in candidates
        ],
    )


def _analysis_response(
    session: Session,
    project: Project,
    profile: SolicitationProfile,
    run: SolicitationAnalysisRun,
) -> SolicitationAnalysisResponse:
    current_fingerprint = _input_fingerprint(_input_documents(session, project.id))
    by_field: dict[SolicitationField, list[SolicitationCandidate]] = {
        field: [] for field in _FIELD_ORDER
    }
    for candidate in run.candidates:
        by_field[candidate.field_key].append(candidate)
    decisions = sorted(run.decisions, key=lambda decision: (decision.applied_at, decision.id))
    return SolicitationAnalysisResponse(
        project_id=project.id,
        run_id=run.id,
        analyzed_at=run.analyzed_at,
        input_fingerprint=run.input_fingerprint,
        rule_version=run.rule_version,
        stale=current_fingerprint != run.input_fingerprint,
        project_updated_at=project.updated_at,
        profile_updated_at=profile.updated_at,
        profile=SolicitationProfileResponse.model_validate(profile),
        fields=[_field_response(field, by_field[field]) for field in _FIELD_ORDER],
        decisions=[SolicitationDecisionResponse.model_validate(decision) for decision in decisions],
    )


def _run_query(project_id: str) -> Any:
    return (
        select(SolicitationAnalysisRun)
        .options(
            selectinload(SolicitationAnalysisRun.candidates),
            selectinload(SolicitationAnalysisRun.decisions),
        )
        .where(SolicitationAnalysisRun.project_id == project_id)
        .order_by(SolicitationAnalysisRun.analyzed_at.desc(), SolicitationAnalysisRun.id.desc())
    )


def _run_by_id_query(project_id: str, run_id: str) -> Any:
    return (
        select(SolicitationAnalysisRun)
        .options(
            selectinload(SolicitationAnalysisRun.candidates),
            selectinload(SolicitationAnalysisRun.decisions),
        )
        .where(
            SolicitationAnalysisRun.project_id == project_id,
            SolicitationAnalysisRun.id == run_id,
        )
    )


@router.get("/solicitation-details", response_model=SolicitationAnalysisResponse)
def get_solicitation_details(
    project_id: str, session: Session = Depends(get_session)
) -> SolicitationAnalysisResponse:
    project = _project(session, project_id)
    profile = _profile(session, project_id)
    current_fingerprint = _input_fingerprint(_input_documents(session, project_id))
    run = session.scalar(
        select(SolicitationAnalysisRun)
        .options(
            selectinload(SolicitationAnalysisRun.candidates),
            selectinload(SolicitationAnalysisRun.decisions),
        )
        .where(
            SolicitationAnalysisRun.project_id == project_id,
            SolicitationAnalysisRun.input_fingerprint == current_fingerprint,
        )
    )
    if run is None:
        run = session.scalar(_run_query(project_id))
    if run is None:
        raise HTTPException(
            status_code=404,
            detail="No solicitation-detail analysis exists. Run analysis first.",
        )
    return _analysis_response(session, project, profile, run)


@router.post("/solicitation-details/analyze", response_model=SolicitationAnalysisResponse)
def analyze_solicitation_details(
    project_id: str, session: Session = Depends(get_session)
) -> SolicitationAnalysisResponse:
    project = _project(session, project_id)
    profile = _profile(session, project_id)
    documents = _input_documents(session, project_id)
    fingerprint = _input_fingerprint(documents)
    run = session.scalar(
        select(SolicitationAnalysisRun)
        .options(
            selectinload(SolicitationAnalysisRun.candidates),
            selectinload(SolicitationAnalysisRun.decisions),
        )
        .where(
            SolicitationAnalysisRun.project_id == project_id,
            SolicitationAnalysisRun.input_fingerprint == fingerprint,
        )
    )
    if run is not None:
        return _analysis_response(session, project, profile, run)

    run = SolicitationAnalysisRun(
        project_id=project_id,
        input_fingerprint=fingerprint,
        rule_version=RULE_VERSION,
    )
    session.add(run)
    seen: set[str] = set()
    total_candidates = 0
    for document in documents:
        if document.status != DocumentStatus.EXTRACTED:
            continue
        markers = _source_markers(document.extracted_text)
        for detected in _detect(document):
            candidate = _new_candidate(run, document, detected, markers)
            if candidate.candidate_fingerprint in seen:
                continue
            seen.add(candidate.candidate_fingerprint)
            total_candidates += 1
            if total_candidates > _MAX_CANDIDATES_PER_RUN:
                raise HTTPException(
                    status_code=413,
                    detail="Solicitation-detail detection exceeded the per-run safety limit.",
                )
            session.add(candidate)
    session.commit()
    run = session.scalar(_run_by_id_query(project_id, run.id))
    assert run is not None
    return _analysis_response(session, project, profile, run)


def _same_timestamp(actual: datetime, expected: datetime) -> bool:
    return actual.astimezone(UTC) == expected.astimezone(UTC)


def _validate_candidate_source(candidate: SolicitationCandidate, document: Document) -> None:
    if (
        document.project_id != candidate.project_id
        or document.classification not in _INPUT_CLASSIFICATIONS
        or document.classification != candidate.document_classification
        or document.blob_sha256 != candidate.document_sha256
        or hashlib.sha256(document.extracted_text.encode("utf-8")).hexdigest()
        != candidate.document_text_sha256
        or candidate.source_start < 0
        or candidate.source_end <= candidate.source_start
        or candidate.source_end > len(document.extracted_text)
        or document.extracted_text[candidate.source_start : candidate.source_end]
        != candidate.excerpt
    ):
        raise HTTPException(
            status_code=409,
            detail="Candidate source evidence changed. Run solicitation-detail analysis again.",
        )


def _current_value(field: SolicitationField, project: Project, profile: SolicitationProfile) -> Any:
    values = {
        SolicitationField.TITLE: project.name,
        SolicitationField.SOLICITATION_NUMBER: project.solicitation_number,
        SolicitationField.AGENCY: {
            "agency": project.agency,
            "issuing_office": profile.issuing_office,
        },
        SolicitationField.DUE_AT: {
            "due_at": project.due_at.isoformat() if project.due_at else None,
            "due_timezone": project.due_timezone,
        },
        SolicitationField.NAICS_CODE: profile.naics_code,
        SolicitationField.PSC_CODE: profile.psc_code,
        SolicitationField.SET_ASIDE: profile.set_aside,
        SolicitationField.CONTRACT_TYPE: profile.contract_type,
        SolicitationField.POINTS_OF_CONTACT: profile.points_of_contact,
    }
    return values[field]


def _apply_value(
    field: SolicitationField,
    candidates: list[SolicitationCandidate],
    project: Project,
    profile: SolicitationProfile,
) -> Any:
    if field == SolicitationField.POINTS_OF_CONTACT:
        values = [candidate.normalized_value for candidate in candidates]
        profile.points_of_contact = values
        return values
    normalized = candidates[0].normalized_value
    if field == SolicitationField.TITLE:
        project.name = str(normalized["title"])
        return project.name
    if field == SolicitationField.SOLICITATION_NUMBER:
        project.solicitation_number = str(normalized["solicitation_number"])
        return project.solicitation_number
    if field == SolicitationField.AGENCY:
        project.agency = str(normalized["agency"])
        profile.issuing_office = str(normalized.get("issuing_office") or normalized["agency"])
        return {"agency": project.agency, "issuing_office": profile.issuing_office}
    if field == SolicitationField.DUE_AT:
        if (
            not candidates[0].applicable
            or not normalized.get("due_at")
            or not normalized.get("due_timezone")
        ):
            raise HTTPException(
                status_code=422,
                detail="The selected deadline needs an explicit timezone before it can be applied.",
            )
        due_at = datetime.fromisoformat(str(normalized["due_at"]).replace("Z", "+00:00"))
        if due_at.tzinfo is None or due_at.utcoffset() is None:
            raise HTTPException(
                status_code=422, detail="The selected deadline is not timezone-aware."
            )
        timezone = str(normalized["due_timezone"])
        ZoneInfo(timezone)
        project.due_at = due_at
        project.due_timezone = timezone
        return {"due_at": due_at.isoformat(), "due_timezone": timezone}
    profile_field = {
        SolicitationField.NAICS_CODE: "naics_code",
        SolicitationField.PSC_CODE: "psc_code",
        SolicitationField.SET_ASIDE: "set_aside",
        SolicitationField.CONTRACT_TYPE: "contract_type",
    }[field]
    value = normalized[profile_field]
    setattr(profile, profile_field, value)
    return value


@router.post("/solicitation-details/apply", response_model=SolicitationApplyResponse)
def apply_solicitation_details(
    project_id: str,
    payload: SolicitationApplyRequest,
    session: Session = Depends(get_session),
) -> SolicitationApplyResponse:
    project = _project(session, project_id)
    profile = _profile(session, project_id)
    if not _same_timestamp(
        project.updated_at, payload.expected_project_updated_at
    ) or not _same_timestamp(profile.updated_at, payload.expected_profile_updated_at):
        raise HTTPException(
            status_code=409,
            detail="Project metadata changed after this review loaded. Refresh before applying.",
        )
    run = session.scalar(
        select(SolicitationAnalysisRun)
        .options(
            selectinload(SolicitationAnalysisRun.candidates).selectinload(
                SolicitationCandidate.document
            ),
            selectinload(SolicitationAnalysisRun.decisions),
        )
        .where(
            SolicitationAnalysisRun.id == payload.run_id,
            SolicitationAnalysisRun.project_id == project_id,
        )
    )
    if run is None:
        raise HTTPException(status_code=404, detail="Solicitation-detail analysis not found.")
    if _input_fingerprint(_input_documents(session, project_id)) != run.input_fingerprint:
        raise HTTPException(
            status_code=409,
            detail="Solicitation documents changed. Run solicitation-detail analysis again.",
        )
    candidates_by_id = {candidate.id: candidate for candidate in run.candidates}
    selections: list[tuple[SolicitationField, list[SolicitationCandidate]]] = []
    for approval in payload.approvals:
        selected: list[SolicitationCandidate] = []
        for candidate_id in approval.candidate_ids:
            candidate = candidates_by_id.get(candidate_id)
            if (
                candidate is None
                or candidate.project_id != project_id
                or candidate.run_id != run.id
                or candidate.field_key != approval.field_key
            ):
                raise HTTPException(
                    status_code=422,
                    detail="An approved candidate does not belong to this project, run, or field.",
                )
            _validate_candidate_source(candidate, candidate.document)
            if not candidate.applicable:
                raise HTTPException(
                    status_code=422,
                    detail="A selected candidate needs reviewer input before it can be applied.",
                )
            selected.append(candidate)
        selections.append((approval.field_key, selected))

    applied_at = utc_now()
    new_decisions: list[SolicitationDecision] = []
    for field, selected in selections:
        previous = _current_value(field, project, profile)
        applied = _apply_value(field, selected, project, profile)
        for candidate in selected:
            decision = SolicitationDecision(
                project_id=project_id,
                run_id=run.id,
                candidate_id=candidate.id,
                field_key=field,
                reviewer=payload.reviewer,
                previous_value=previous,
                applied_value=(candidate.normalized_value if len(selected) > 1 else applied),
                applied_at=applied_at,
            )
            session.add(decision)
            new_decisions.append(decision)
    project.updated_at = applied_at
    profile.updated_at = applied_at
    session.commit()
    session.refresh(project)
    session.refresh(profile)
    session.expire(run, ["decisions"])
    run = session.scalar(_run_by_id_query(project_id, run.id))
    assert run is not None
    analysis = _analysis_response(session, project, profile, run)
    return SolicitationApplyResponse(
        project=ProjectResponse.model_validate(project),
        profile=SolicitationProfileResponse.model_validate(profile),
        applied_fields=[field for field, _ in selections],
        decisions=[SolicitationDecisionResponse.model_validate(item) for item in new_decisions],
        analysis=analysis,
    )
