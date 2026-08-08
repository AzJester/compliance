from __future__ import annotations

import hashlib
import re
from bisect import bisect_right
from collections.abc import Iterator
from dataclasses import dataclass
from itertools import islice

from .models import (
    Document,
    ObligationOwner,
    RequirementApplicability,
    RequirementCategory,
    RequirementSection,
)

RULE_VERSION = "rules-v1"
EXTRACTION_METHOD = "deterministic-rules"
MAX_CDRL_SOURCE_CHARACTERS = 32_000
DEFAULT_MAX_REQUIREMENT_CANDIDATES_PER_DOCUMENT = 5_000
DEFAULT_MAX_CDRL_CANDIDATES_PER_DOCUMENT = 500

_CDRL_MARKERS_PER_CANDIDATE = 8
_CDRL_MARKER_SLACK = 32

_LINE_RE = re.compile(r"[^\r\n]+")
_SECTION_RE = re.compile(r"^\s*SECTION\s+([A-M])(?:\s*[-\u2013\u2014:]\s*|\s+)", re.I)
_SHORT_SECTION_RE = re.compile(r"^\s*([A-M])\s*[-\u2013\u2014:]\s*([A-Z].*)$")
_DOT_SECTION_RE = re.compile(r"^\s*([A-M])\.\s+(.+)$")
_MARKER_RE = re.compile(
    r"^\[(?:PDF Page \d+|DOCX Paragraph \d+|DOCX Table \d+ Row \d+|"
    r'XLSX Sheet "[^"]+" Row \d+|Slide \d+)\]$'
)
_MANDATORY_RE = re.compile(r"\b(is\s+required\s+to|required\s+to|shall|must|will)\b", re.I)
_L_IMPERATIVE_RE = re.compile(r"^\s*(submit|provide|include)\b", re.I)
_MODAL_SPLIT_RE = re.compile(
    r"(?:\s*;\s*|\s+(?:and|but)\s+)"
    r"(?=(?:the\s+)?(?:offeror|contractor|government|subcontractor)\s+"
    r"(?:shall|must|will|is\s+required\s+to|required\s+to)\b)",
    re.I,
)
_CLAUSE_NUMBER_PATTERN = r"(?:(?:FAR|DFARS)[ \t]+)?(?:52|252)\.\d{3}-\d+[A-Z]?"
_CLAUSE_RE = re.compile(rf"(?<![A-Z0-9]){_CLAUSE_NUMBER_PATTERN}(?![A-Z0-9])", re.I)
_CLAUSE_LINE_RE = re.compile(rf"^\s*{_CLAUSE_NUMBER_PATTERN}(?![A-Z0-9])", re.I)
_FORM_RE = re.compile(r"(?im)^[ \t]*DD\s+FORM\s+1423(?:-1)?(?:\b[^\r\n]*)")
_CDRL_TITLE_RE = re.compile(
    r"(?im)^[ \t]*CONTRACT[ \t]+DATA[ \t]+REQUIREMENTS[ \t]+LIST(?:[^\r\n]*)"
)


class ExtractionLimitError(Exception):
    """Deterministic extraction exceeded a configured candidate safety limit."""


def _candidate_limit_error(kind: str, scope: str, limit: int) -> ExtractionLimitError:
    return ExtractionLimitError(
        f"{kind} extraction exceeded the {scope} safety limit of {limit} candidates."
    )


_L_KEYWORDS = (
    "submit",
    "proposal",
    "volume",
    "page limit",
    "font",
    "format",
    "include",
    "provide",
    "resume",
)
_M_KEYWORDS = (
    "evaluat",
    "factor",
    "subfactor",
    "importance",
    "important",
    "rating",
    "tradeoff",
    "pass/fail",
    "approximately equal",
    "significantly more",
)

_FIELD_SPECS: tuple[tuple[str, str, str], ...] = (
    ("block_a_contract_line_item_number", "A", r"CONTRACT\s+LINE\s+ITEM\s+NO\.?"),
    ("block_b_exhibit", "B", r"EXHIBIT"),
    ("block_c_category", "C", r"CATEGORY"),
    ("block_d_system_item", "D", r"SYSTEM\s*/?\s*ITEM"),
    ("block_e_contract_pr_number", "E", r"CONTRACT\s*/?\s*PR\s+NO\.?"),
    ("block_f_contractor", "F", r"CONTRACTOR"),
    ("block_1_data_item_number", "1", r"DATA\s+ITEM\s+NO\.?"),
    ("block_2_title", "2", r"TITLE\s+OF\s+DATA\s+ITEM"),
    ("block_3_subtitle", "3", r"SUBTITLE"),
    (
        "block_4_authority",
        "4",
        r"AUTHORITY(?:\s*\(\s*DATA\s+ACQUISITION\s+DOCUMENT\s+NO\.?\s*\))?",
    ),
    ("block_5_contract_reference", "5", r"CONTRACT\s+REFERENCE"),
    ("block_6_requiring_office", "6", r"REQUIRING\s+OFFICE"),
    ("block_7_dd250_requirement", "7", r"DD\s*250\s+REQ(?:UIREMENT)?\.?"),
    ("block_8_approval_code", "8", r"APP(?:ROVAL)?\s+CODE"),
    (
        "block_9_distribution_statement",
        "9",
        r"DIST(?:RIBUTION)?\s+STATEMENT\s+REQUIRED",
    ),
    ("block_10_frequency", "10", r"FREQUENCY"),
    ("block_11_as_of_date", "11", r"AS\s+OF\s+DATE"),
    ("block_12_first_submission", "12", r"DATE\s+OF\s+FIRST\s+SUBMISSION"),
    (
        "block_13_subsequent_submission",
        "13",
        r"DATE\s+OF\s+SUBSEQUENT\s+SUBMISSION(?:\s*/\s*EVENT)?",
    ),
    ("block_14_distribution", "14", r"DISTRIBUTION"),
    ("block_15_total", "15", r"TOTAL"),
    ("block_16_remarks", "16", r"REMARKS"),
    ("block_17_price_group", "17", r"PRICE\s+GROUP"),
    ("block_18_estimated_total_price", "18", r"ESTIMATED\s+TOTAL\s+PRICE"),
)


@dataclass(frozen=True, slots=True)
class RequirementCandidate:
    fingerprint: str
    source_text: str
    source_start: int
    source_end: int
    source_locator: str
    requirement_text: str
    section: RequirementSection
    category: RequirementCategory
    mandatory_term: str | None
    obligation_owner: ObligationOwner
    applicability: RequirementApplicability
    confidence: float


@dataclass(frozen=True, slots=True)
class CDRLCandidate:
    fingerprint: str
    requirement: RequirementCandidate
    source_text: str
    source_start: int
    source_end: int
    source_locator: str
    fields: dict[str, str | None]
    missing_fields: list[str]
    source_truncated: bool


def _section_heading(line: str) -> RequirementSection | None:
    for pattern in (_SECTION_RE, _SHORT_SECTION_RE):
        match = pattern.match(line)
        if match:
            return RequirementSection(match.group(1).upper())
    dotted = _DOT_SECTION_RE.match(line)
    if dotted and dotted.group(2).strip() == dotted.group(2).strip().upper():
        token = dotted.group(1).upper()
        if any(
            field_token == token and re.match(label, dotted.group(2), re.I)
            for _field_name, field_token, label in _FIELD_SPECS
        ):
            return None
        return RequirementSection(dotted.group(1).upper())
    return None


def _document_context(
    text: str,
) -> tuple[list[int], list[RequirementSection], list[int], list[int], list[str]]:
    section_positions: list[int] = []
    sections: list[RequirementSection] = []
    line_starts: list[int] = []
    marker_positions: list[int] = []
    markers: list[str] = []
    for line_match in _LINE_RE.finditer(text):
        line_starts.append(line_match.start())
        line = line_match.group(0).strip()
        heading = _section_heading(line)
        if heading is not None:
            section_positions.append(line_match.start())
            sections.append(heading)
        if _MARKER_RE.fullmatch(line):
            marker_positions.append(line_match.start())
            markers.append(line[1:-1])
    if not line_starts:
        line_starts.append(0)
    return section_positions, sections, line_starts, marker_positions, markers


def _section_at(
    position: int, section_positions: list[int], sections: list[RequirementSection]
) -> RequirementSection:
    index = bisect_right(section_positions, position) - 1
    return sections[index] if index >= 0 else RequirementSection.UNKNOWN


def _locator(
    start: int,
    end: int,
    line_starts: list[int],
    marker_positions: list[int],
    markers: list[str],
) -> str:
    marker_index = bisect_right(marker_positions, start) - 1
    if marker_index >= 0:
        return f"{markers[marker_index]}; characters {start}-{end}"
    line_number = bisect_right(line_starts, start)
    return f"Line {line_number}; characters {start}-{end}"


def _trim_span(text: str, start: int, end: int) -> tuple[int, int]:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return start, end


def _sentence_spans(text: str, start: int, end: int) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    cursor = start
    for boundary in re.finditer(r"[.!?](?=\s+[A-Z0-9(]|\s*$)", text[start:end]):
        boundary_end = start + boundary.end()
        trimmed = _trim_span(text, cursor, boundary_end)
        if trimmed[1] > trimmed[0]:
            spans.append(trimmed)
        cursor = boundary_end
    trimmed = _trim_span(text, cursor, end)
    if trimmed[1] > trimmed[0]:
        spans.append(trimmed)
    return spans


def _modal_spans(text: str, start: int, end: int) -> list[tuple[int, int]]:
    boundaries = list(_MODAL_SPLIT_RE.finditer(text[start:end]))
    if not boundaries:
        return [(start, end)]
    spans: list[tuple[int, int]] = []
    cursor = start
    for boundary in boundaries:
        boundary_start = start + boundary.start()
        boundary_end = start + boundary.end()
        trimmed = _trim_span(text, cursor, boundary_start)
        if trimmed[1] > trimmed[0]:
            spans.append(trimmed)
        cursor = boundary_end
    trimmed = _trim_span(text, cursor, end)
    if trimmed[1] > trimmed[0]:
        spans.append(trimmed)
    return spans


def _source_units(text: str, max_characters: int = 8_000) -> Iterator[tuple[int, int]]:
    """Join physical continuation lines without crossing structural boundaries."""

    current_start: int | None = None
    current_end: int | None = None
    previous_line_end = 0
    for line_match in _LINE_RE.finditer(text):
        line = line_match.group(0).strip()
        structural = _MARKER_RE.fullmatch(line) or _section_heading(line) is not None
        clause_row = _CLAUSE_LINE_RE.match(line) is not None
        gap = text[previous_line_end : line_match.start()]
        blank_boundary = bool(re.search(r"(?:\r?\n)[ \t]*(?:\r?\n)", gap))
        terminal = bool(
            current_end is not None
            and re.search(r"[.!?;:]\s*$", text[max(0, current_end - 16) : current_end])
        )
        would_exceed = bool(
            current_start is not None and line_match.end() - current_start > max_characters
        )
        if current_start is not None and (
            structural or clause_row or blank_boundary or terminal or would_exceed
        ):
            assert current_end is not None
            yield _trim_span(text, current_start, current_end)
            current_start = None
            current_end = None
        if not structural and line_match.end() - line_match.start() > max_characters:
            cursor = line_match.start()
            while cursor < line_match.end():
                chunk_end = min(cursor + max_characters, line_match.end())
                if chunk_end < line_match.end():
                    whitespace = text.rfind(" ", cursor, chunk_end)
                    if whitespace > cursor:
                        chunk_end = whitespace
                bounded = _trim_span(text, cursor, chunk_end)
                if bounded[1] > bounded[0]:
                    yield bounded
                cursor = max(chunk_end, cursor + 1)
            previous_line_end = line_match.end()
            continue
        if not structural and line:
            if current_start is None:
                current_start = line_match.start()
            current_end = line_match.end()
        previous_line_end = line_match.end()
    if current_start is not None and current_end is not None:
        yield _trim_span(text, current_start, current_end)


def _owner(source: str, section: RequirementSection) -> ObligationOwner:
    lower = source.casefold()
    if "subcontractor" in lower:
        return ObligationOwner.SUBCONTRACTOR
    if "offeror" in lower or "proposer" in lower:
        return ObligationOwner.OFFEROR
    if "contractor" in lower:
        return ObligationOwner.CONTRACTOR
    if "government" in lower:
        return ObligationOwner.GOVERNMENT
    if section == RequirementSection.L:
        return ObligationOwner.OFFEROR
    return ObligationOwner.INFORMATIONAL


def _category(source: str, section: RequirementSection) -> RequirementCategory:
    lower = source.casefold()
    if section == RequirementSection.L:
        return RequirementCategory.SUBMISSION_INSTRUCTION
    if section == RequirementSection.M:
        return RequirementCategory.EVALUATION_FACTOR
    if _CLAUSE_RE.search(source):
        return RequirementCategory.CLAUSE
    keyword_categories = (
        (
            ("cui", "cmmc", "nist", "cyber", "classified", "clearance", "dd 254"),
            RequirementCategory.SECURITY,
        ),
        (
            (
                "data rights",
                "technical data",
                "intellectual property",
                "software rights",
                "license rights",
            ),
            RequirementCategory.DATA_RIGHTS,
        ),
        (
            ("price", "pricing", "cost", "clin", "fee", "basis of estimate"),
            RequirementCategory.PRICING,
        ),
        (
            ("staff", "personnel", "labor categor", "key personnel", "resume", "fte"),
            RequirementCategory.STAFFING,
        ),
        (("deliver", "report", "data item", "cdrl"), RequirementCategory.DELIVERABLE),
        (
            ("within ", "no later than", "monthly", "quarterly", "milestone", "schedule"),
            RequirementCategory.SCHEDULE,
        ),
        (
            ("certif", "representation", "organizational conflict", " oci", "signature", "sam.gov"),
            RequirementCategory.REPRESENTATION,
        ),
    )
    for keywords, category in keyword_categories:
        if any(keyword in lower for keyword in keywords):
            return category
    return RequirementCategory.GENERAL


def _applicability(
    section: RequirementSection,
    category: RequirementCategory,
    owner: ObligationOwner,
) -> RequirementApplicability:
    if section == RequirementSection.L or owner == ObligationOwner.OFFEROR:
        return RequirementApplicability.PROPOSAL
    if section == RequirementSection.M:
        return RequirementApplicability.SOLICITATION
    if owner in {ObligationOwner.CONTRACTOR, ObligationOwner.SUBCONTRACTOR}:
        return RequirementApplicability.POST_AWARD
    if category == RequirementCategory.REPRESENTATION:
        return RequirementApplicability.PROPOSAL
    if owner == ObligationOwner.GOVERNMENT:
        return RequirementApplicability.POST_AWARD
    return RequirementApplicability.INFORMATIONAL


def _qualifies(source: str, section: RequirementSection) -> bool:
    lower = source.casefold()
    if _MANDATORY_RE.search(source) or _CLAUSE_RE.search(source):
        return True
    if section == RequirementSection.L:
        return any(keyword in lower for keyword in _L_KEYWORDS)
    if section == RequirementSection.M:
        return any(keyword in lower for keyword in _M_KEYWORDS)
    return lower.startswith(("deliverable:", "schedule:", "staffing:", "security:", "pricing:"))


def _fingerprint(
    document: Document,
    start: int,
    end: int,
    category: RequirementCategory,
    source: str,
) -> str:
    material = f"{document.blob_sha256}:{start}:{end}:{category.value}:{source}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _requirement_candidates(
    document: Document,
    section_positions: list[int],
    sections: list[RequirementSection],
    line_starts: list[int],
    marker_positions: list[int],
    markers: list[str],
    max_candidates: int,
) -> list[RequirementCandidate]:
    text = document.extracted_text
    candidates: list[RequirementCandidate] = []
    seen: set[str] = set()
    for unit_start, unit_end in _source_units(text):
        clause_unit = _CLAUSE_LINE_RE.match(text[unit_start:unit_end]) is not None
        sentence_spans = (
            [(unit_start, unit_end)] if clause_unit else _sentence_spans(text, unit_start, unit_end)
        )
        for sentence_start, sentence_end in sentence_spans:
            modal_spans = (
                [(sentence_start, sentence_end)]
                if clause_unit
                else _modal_spans(text, sentence_start, sentence_end)
            )
            for start, end in modal_spans:
                source = text[start:end]
                section = _section_at(start, section_positions, sections)
                if not _qualifies(source, section):
                    continue
                category = _category(source, section)
                fingerprint = _fingerprint(document, start, end, category, source)
                if fingerprint in seen:
                    continue
                if len(candidates) >= max_candidates:
                    raise _candidate_limit_error("Requirement", "per-document", max_candidates)
                seen.add(fingerprint)
                mandatory = _MANDATORY_RE.search(source)
                imperative = (
                    _L_IMPERATIVE_RE.search(source)
                    if section == RequirementSection.L and mandatory is None
                    else None
                )
                owner = _owner(source, section)
                candidates.append(
                    RequirementCandidate(
                        fingerprint=fingerprint,
                        source_text=source,
                        source_start=start,
                        source_end=end,
                        source_locator=_locator(
                            start,
                            end,
                            line_starts,
                            marker_positions,
                            markers,
                        ),
                        requirement_text=source,
                        section=section,
                        category=category,
                        mandatory_term=(
                            mandatory.group(0).upper()
                            if mandatory
                            else imperative.group(1).upper()
                            if imperative
                            else None
                        ),
                        obligation_owner=owner,
                        applicability=_applicability(section, category, owner),
                        confidence=0.96 if mandatory or imperative else 0.9,
                    )
                )
    return candidates


def _field_matches(form_text: str) -> list[tuple[int, int, str]]:
    matches: list[tuple[int, int, str]] = []
    for field_name, token, label in _FIELD_SPECS:
        token_pattern = re.escape(token) + r"(?![A-Z0-9])"
        pattern = re.compile(
            rf"(?im)(?:(?<!\S){token_pattern}\s*[.):-]\s*{label}|"
            rf"(?:^[ \t]*|(?<=\t)[ ]*)BLOCK[ \t]+{token_pattern})"
            rf"(?:[ \t]*:[ \t]*|\t+|[ ]+|\r?\n[ \t]*)"
        )
        match = pattern.search(form_text)
        if match:
            matches.append((match.start(), match.end(), field_name))
    return sorted(matches)


def _field_value(raw_value: str) -> str | None:
    lines = [
        line
        for line in raw_value.splitlines()
        if not _MARKER_RE.fullmatch(line.strip()) and not _FORM_RE.fullmatch(line.strip())
    ]
    value = "\n".join(lines).strip()
    return value or None


def _ignorable_cdrl_gap(value: str) -> bool:
    return all(
        _MARKER_RE.fullmatch(line.strip()) is not None
        for line in value.splitlines()
        if line.strip()
    )


def _has_cdrl_fields(text: str, start: int, end: int) -> bool:
    bounded_end = min(end, start + MAX_CDRL_SOURCE_CHARACTERS)
    return bool(_field_matches(text[start:bounded_end]))


def _cdrl_record_spans(
    text: str, section_positions: list[int], max_candidates: int
) -> list[tuple[int, int]]:
    """Find title-led forms and legacy marker-led forms without treating footers as starts."""

    marker_limit = max_candidates * _CDRL_MARKERS_PER_CANDIDATE + _CDRL_MARKER_SLACK
    form_markers = list(islice(_FORM_RE.finditer(text), marker_limit + 1))
    if len(form_markers) > marker_limit:
        raise _candidate_limit_error("CDRL", "per-document", max_candidates)
    titles = list(islice(_CDRL_TITLE_RE.finditer(text), max_candidates + 1))
    if len(titles) > max_candidates:
        raise _candidate_limit_error("CDRL", "per-document", max_candidates)
    form_positions = [marker.start() for marker in form_markers]
    title_positions = [title.start() for title in titles]
    consumed_markers: set[int] = set()
    spans: list[tuple[int, int]] = []
    seen_spans: set[tuple[int, int]] = set()

    def add_span(start: int, end: int) -> None:
        span = (start, end)
        if span in seen_spans:
            return
        if len(spans) >= max_candidates:
            raise _candidate_limit_error("CDRL", "per-document", max_candidates)
        spans.append(span)
        seen_spans.add(span)

    for title_index, title in enumerate(titles):
        next_title = titles[title_index + 1].start() if title_index + 1 < len(titles) else len(text)
        next_section_index = bisect_right(section_positions, title.start())
        next_section = (
            section_positions[next_section_index]
            if next_section_index < len(section_positions)
            else len(text)
        )
        natural_end = min(next_title, next_section)
        start = title.start()

        preceding_marker_index = bisect_right(form_positions, title.start()) - 1
        for marker_index in range(preceding_marker_index, -1, -1):
            marker = form_markers[marker_index]
            if marker_index in consumed_markers or marker.end() > title.start():
                continue
            gap_size = title.start() - marker.end()
            if gap_size <= 2_000 and _ignorable_cdrl_gap(text[marker.end() : title.start()]):
                start = marker.start()
                consumed_markers.add(marker_index)
            break

        end = natural_end
        following_marker_index = bisect_right(form_positions, title.end())
        for marker_index in range(following_marker_index, len(form_markers)):
            marker = form_markers[marker_index]
            if marker.start() >= natural_end:
                break
            if _has_cdrl_fields(text, title.end(), marker.start()):
                end = marker.end()
                consumed_markers.add(marker_index)
                break
            consumed_markers.add(marker_index)

        if _has_cdrl_fields(text, start, end):
            add_span(start, end)

    covered_spans: list[tuple[int, int]] = []
    for start, end in sorted(spans):
        if covered_spans and start <= covered_spans[-1][1]:
            previous_start, previous_end = covered_spans[-1]
            covered_spans[-1] = (previous_start, max(previous_end, end))
        else:
            covered_spans.append((start, end))
    covered_starts = [start for start, _end in covered_spans]

    for marker_index, marker in enumerate(form_markers):
        covered_index = bisect_right(covered_starts, marker.start()) - 1
        marker_is_covered = covered_index >= 0 and marker.start() < covered_spans[covered_index][1]
        if marker_index in consumed_markers or marker_is_covered:
            continue
        boundary_candidates = [len(text)]
        if marker_index + 1 < len(form_markers):
            boundary_candidates.append(form_markers[marker_index + 1].start())
        next_title_index = bisect_right(title_positions, marker.start())
        if next_title_index < len(titles):
            boundary_candidates.append(titles[next_title_index].start())
        next_section_index = bisect_right(section_positions, marker.start())
        if next_section_index < len(section_positions):
            boundary_candidates.append(section_positions[next_section_index])
        end = min(boundary_candidates)
        if _has_cdrl_fields(text, marker.start(), end):
            add_span(marker.start(), end)

    return sorted(spans)


def _parse_cdrls(
    document: Document,
    section_positions: list[int],
    sections: list[RequirementSection],
    line_starts: list[int],
    marker_positions: list[int],
    markers: list[str],
    max_candidates: int,
) -> list[CDRLCandidate]:
    text = document.extracted_text
    output: list[CDRLCandidate] = []
    for record_start, record_end in _cdrl_record_spans(text, section_positions, max_candidates):
        source_truncated = record_end - record_start > MAX_CDRL_SOURCE_CHARACTERS
        bounded_end = min(record_end, record_start + MAX_CDRL_SOURCE_CHARACTERS)
        start, end = _trim_span(text, record_start, bounded_end)
        if end <= start:
            continue
        source = text[start:end]
        field_matches = _field_matches(source)
        fields: dict[str, str | None] = {name: None for name, _token, _label in _FIELD_SPECS}
        for field_index, (label_start, value_start, field_name) in enumerate(field_matches):
            value_end = (
                field_matches[field_index + 1][0]
                if field_index + 1 < len(field_matches)
                else len(source)
            )
            line_start = source.rfind("\n", 0, label_start) + 1
            line_end = source.find("\n", label_start)
            if line_end < 0:
                line_end = len(source)
            labels_on_line = sum(
                line_start <= other_start <= line_end
                for other_start, _other_value_start, _other_field_name in field_matches
            )
            if labels_on_line > 1:
                value_end = min(value_end, line_end)
            fields[field_name] = (
                _field_value(source[value_start:value_end]) if value_end > value_start else None
            )
        missing = [field for field, value in fields.items() if value is None]
        section = _section_at(start, section_positions, sections)
        item_number = fields["block_1_data_item_number"]
        title = fields["block_2_title"]
        normalized = (
            ": ".join(part for part in ("CDRL", item_number, title) if part)
            or "Contract Data Requirements List item"
        )
        requirement_fingerprint = _fingerprint(
            document, start, end, RequirementCategory.CDRL, source
        )
        requirement = RequirementCandidate(
            fingerprint=requirement_fingerprint,
            source_text=source,
            source_start=start,
            source_end=end,
            source_locator=_locator(start, end, line_starts, marker_positions, markers),
            requirement_text=normalized,
            section=section,
            category=RequirementCategory.CDRL,
            mandatory_term=None,
            obligation_owner=ObligationOwner.CONTRACTOR,
            applicability=RequirementApplicability.POST_AWARD,
            confidence=0.98 if not missing else 0.82,
        )
        cdrl_material = f"{document.blob_sha256}:{start}:{end}:CDRL-RECORD:{source}"
        if len(output) >= max_candidates:
            raise _candidate_limit_error("CDRL", "per-document", max_candidates)
        output.append(
            CDRLCandidate(
                fingerprint=hashlib.sha256(cdrl_material.encode("utf-8")).hexdigest(),
                requirement=requirement,
                source_text=source,
                source_start=start,
                source_end=end,
                source_locator=requirement.source_locator,
                fields=fields,
                missing_fields=missing,
                source_truncated=source_truncated,
            )
        )
    return output


def analyze_document(
    document: Document,
    *,
    max_requirement_candidates: int = DEFAULT_MAX_REQUIREMENT_CANDIDATES_PER_DOCUMENT,
    max_cdrl_candidates: int = DEFAULT_MAX_CDRL_CANDIDATES_PER_DOCUMENT,
) -> tuple[list[RequirementCandidate], list[CDRLCandidate]]:
    if max_requirement_candidates <= 0 or max_cdrl_candidates <= 0:
        raise ValueError("Candidate limits must be greater than zero")
    text = document.extracted_text
    section_positions, sections, line_starts, marker_positions, markers = _document_context(text)
    requirements = _requirement_candidates(
        document,
        section_positions,
        sections,
        line_starts,
        marker_positions,
        markers,
        max_requirement_candidates,
    )
    cdrls = _parse_cdrls(
        document,
        section_positions,
        sections,
        line_starts,
        marker_positions,
        markers,
        max_cdrl_candidates,
    )
    known = {candidate.fingerprint for candidate in requirements}
    for cdrl in cdrls:
        if cdrl.requirement.fingerprint not in known:
            if len(requirements) >= max_requirement_candidates:
                raise _candidate_limit_error(
                    "Requirement", "per-document", max_requirement_candidates
                )
            requirements.append(cdrl.requirement)
            known.add(cdrl.requirement.fingerprint)
    requirements.sort(key=lambda candidate: (candidate.source_start, candidate.fingerprint))
    cdrls.sort(key=lambda candidate: (candidate.source_start, candidate.fingerprint))
    for candidate in requirements:
        if text[candidate.source_start : candidate.source_end] != candidate.source_text:
            raise ValueError("Requirement source span invariant failed")
    for candidate in cdrls:
        if text[candidate.source_start : candidate.source_end] != candidate.source_text:
            raise ValueError("CDRL source span invariant failed")
    return requirements, cdrls
