from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend.app import workflow_api
from backend.app.models import CrosswalkStatus, Document


def _corpus(
    token_groups: list[set[str]], *, excerpts: list[str] | None = None
) -> workflow_api._ProposalCorpus:
    document = Document(id="proposal-document", extracted_text="")
    resolved_excerpts = excerpts or [" ".join(sorted(tokens)) for tokens in token_groups]
    chunks = tuple(
        workflow_api._ProposalChunk(
            document=document,
            start=index * 100,
            end=(index * 100) + len(excerpt),
            excerpt=excerpt,
            tokens=frozenset(tokens),
        )
        for index, (tokens, excerpt) in enumerate(zip(token_groups, resolved_excerpts, strict=True))
    )
    postings: dict[str, list[int]] = {}
    for index, chunk in enumerate(chunks):
        for token in chunk.tokens:
            postings.setdefault(token, []).append(index)
    return workflow_api._ProposalCorpus(
        chunks=chunks,
        token_index={token: tuple(indices) for token, indices in postings.items()},
    )


def _legacy_match(
    requirement_text: str, proposal_corpus: workflow_api._ProposalCorpus
) -> tuple[CrosswalkStatus, float, Document | None, int, int, str]:
    requirement_tokens = workflow_api._tokens(requirement_text)
    if not requirement_tokens:
        return CrosswalkStatus.MISSING, 0.0, None, 0, 0, ""
    best: tuple[float, Document | None, int, int, str] = (0.0, None, 0, 0, "")
    for chunk in proposal_corpus.chunks:
        if not chunk.tokens:
            continue
        overlap = requirement_tokens.intersection(chunk.tokens)
        recall = len(overlap) / len(requirement_tokens)
        union = requirement_tokens.union(chunk.tokens)
        jaccard = len(overlap) / len(union)
        score = round((0.75 * recall) + (0.25 * jaccard), 4)
        if score > best[0]:
            best = (score, chunk.document, chunk.start, chunk.end, chunk.excerpt)

    score, document, start, end, excerpt = best
    if document is None or score < 0.18:
        return CrosswalkStatus.MISSING, score, None, 0, 0, ""

    required_numbers = set(workflow_api._NUMBER_PATTERN.findall(requirement_text.lower()))
    evidence_numbers = set(workflow_api._NUMBER_PATTERN.findall(excerpt.lower()))
    if (
        score >= 0.25
        and required_numbers
        and evidence_numbers
        and not required_numbers.issubset(evidence_numbers)
    ):
        candidate_status = CrosswalkStatus.CONFLICT
    elif score >= 0.62:
        candidate_status = CrosswalkStatus.COVERED
    elif score >= 0.25:
        candidate_status = CrosswalkStatus.PARTIAL
    else:
        candidate_status = CrosswalkStatus.MISSING
        document = None
        start = 0
        end = 0
        excerpt = ""
    return candidate_status, score, document, start, end, excerpt


@pytest.mark.parametrize(
    ("requirement_text", "token_groups", "excerpts", "expected_status"),
    [
        ("a an the", [{"unrelated"}], None, CrosswalkStatus.MISSING),
        ("alpha bravo", [{"charlie", "delta"}], None, CrosswalkStatus.MISSING),
        (
            "alpha bravo charlie delta echo",
            [{"alpha", "foxtrot", "golf", "hotel", "india", "juliet"}],
            None,
            CrosswalkStatus.MISSING,
        ),
        (
            "alpha bravo charlie delta",
            [{"alpha", "echo", "foxtrot", "golf", "hotel"}],
            None,
            CrosswalkStatus.MISSING,
        ),
        (
            "alpha bravo charlie delta",
            [{"alpha", "bravo", "echo", "foxtrot"}],
            None,
            CrosswalkStatus.PARTIAL,
        ),
        (
            "alpha bravo charlie delta",
            [{"alpha", "bravo", "charlie", "echo"}],
            None,
            CrosswalkStatus.COVERED,
        ),
        (
            "alpha bravo charlie delta 10",
            [{"alpha", "bravo", "charlie", "delta"}],
            ["alpha bravo charlie delta 12"],
            CrosswalkStatus.CONFLICT,
        ),
    ],
)
def test_indexed_matcher_preserves_legacy_threshold_and_conflict_semantics(
    requirement_text: str,
    token_groups: list[set[str]],
    excerpts: list[str] | None,
    expected_status: CrosswalkStatus,
) -> None:
    corpus = _corpus(token_groups, excerpts=excerpts)
    requirement = SimpleNamespace(requirement_text=requirement_text)

    optimized = workflow_api._match_requirement(requirement, corpus)

    assert optimized == _legacy_match(requirement_text, corpus)
    assert optimized[0] == expected_status


def test_indexed_matcher_preserves_earliest_tie_and_deduplicates_postings() -> None:
    corpus = _corpus(
        [
            {"alpha", "bravo", "charlie"},
            {"alpha", "bravo", "charlie"},
            {"alpha", "unrelated"},
        ],
        excerpts=["first exact evidence", "later exact evidence", "weak evidence"],
    )
    requirement_tokens = workflow_api._tokens("alpha bravo charlie")

    candidate_indices = workflow_api._candidate_chunk_indices(requirement_tokens, corpus)
    result = workflow_api._match_requirement(
        SimpleNamespace(requirement_text="alpha bravo charlie"), corpus
    )

    assert candidate_indices == [0, 1, 2]
    assert result[0] == CrosswalkStatus.COVERED
    assert result[5] == "first exact evidence"


def test_inverted_index_avoids_scoring_irrelevant_proposal_chunks() -> None:
    lines = [f"irrelevantword{index} fillerword{index}" for index in range(1_000)]
    lines.extend(["needle evidencealpha", "shared evidencebravo"])
    document = Document(
        id="large-proposal",
        extracted_text="\n\n\n\n".join(lines),
    )
    corpus = workflow_api._proposal_corpus([document])

    candidate_indices = workflow_api._candidate_chunk_indices(
        workflow_api._tokens("needle shared"), corpus
    )

    assert len(corpus.chunks) == 1_002
    assert candidate_indices == [1_000, 1_001]
