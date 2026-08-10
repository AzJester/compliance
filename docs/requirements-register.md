<!-- markdownlint-disable MD013 -->

# Requirements Register

The requirements register converts solicitation text extracted inside the running workstation or container into a traceable inventory that is immediately available for proposal analysis. It is a rules-based baseline: it does not call an external AI or reference service, load a remote model, dereference solicitation links, or transmit document content outside the application boundary.

## Inventory workflow

1. Create a project and upload the solicitation package from **Solicitation**.
2. Resolve any extraction errors or scanned documents marked `NEEDS_OCR`.
3. The application automatically analyzes eligible, nonduplicate documents after upload and opens **Requirements**.
4. Use the complete register and the dedicated Section L, Section M, and CDRL views immediately.
5. Open an item only to correct it, optionally confirm it for the audit trail, or exclude a false positive with a required explanation.
6. Select **Refresh requirements** after adding or reclassifying documents. Stable records retain reviewer edits and decisions.

All candidates begin in `PENDING` state, displayed as **As extracted**. `PENDING` is an active, proposal-analysis-ready state; it does not mean that a reviewer must approve the record before the crosswalk can run. The source documents and solicitation still control whenever an extracted record conflicts with the source.

## Candidate taxonomy

Candidates retain the detected Uniform Contract Format section (`A` through `M`, or `UNKNOWN`) and one primary category:

- General requirement
- Submission instruction
- Evaluation factor
- CDRL
- Clause
- Deliverable
- Schedule
- Staffing
- Security
- Data rights
- Pricing
- Representation or certification

Each candidate also records the detected mandatory term, obligation owner, acquisition-phase applicability, rule version, confidence, exact source excerpt, source document, and available locator.

Section L and Section M are presented as dedicated registers. Section L focuses on proposal organization, content, format, limits, delivery, deadlines, and other instructions to offerors. Section M focuses on evaluation factors, subfactors, relative importance, rating language, award basis, and evaluation risk. The complete inventory remains available when a reviewer needs to investigate an exception outside those sections.

## Provenance rules

The application preserves immutable source text and character offsets separately from the reviewer-editable normalized requirement. It reports only locators supported by local extraction metadata, such as a PDF page, Word paragraph, worksheet row, slide, line, or character range. If the extractor cannot establish a locator, the interface says so instead of inventing one.

Requirement fingerprints are derived deterministically from source identity and location. Repeating analysis against unchanged documents reuses the same records. Reviewer edits, validation states, dismissal reasons, and decision history survive a rerun.

Duplicate document occurrences remain visible in the document manifest for package provenance but are analyzed only once within a project.

## CDRL register

The CDRL register preserves the available DD Form 1423 header fields (Blocks A–F) and item fields (Blocks 1–18), including full Block 14 distribution information and Block 16 remarks or DID tailoring. Values are retained as source text so leading zeros, schedules, copy counts, and contractual wording are not changed by type coercion.

CDRL completeness indicators surface missing or ambiguous source data for exception review; they are not separate human-review gates. Source or document-role changes refresh the inventory and make affected proposal findings stale. Records classified **Reference only** remain available as context but do not create active requirements or count toward proposal coverage.

Missing or ambiguous fields remain empty and are visibly flagged so a reviewer can investigate them when they matter. The rules engine does not infer a DID, delivery date, approval code, distribution statement, or other contractual value that is not present in the extracted source.

Colon-delimited labels and tab-separated label/value cells are recognized. To keep hostile or malformed documents from producing unbounded API and browser payloads, one CDRL source span is capped at 32,000 characters and is explicitly marked as source-capped and incomplete when that limit is reached.

Candidate counts are also bounded before database writes. The default limits are 5,000 requirements and 500 CDRLs per document, and 20,000 requirements and 2,000 CDRLs per extraction run. Administrators can lower these values with the documented `COMPLIANCE_MAX_*_CANDIDATES_*` environment settings. Exceeding a limit returns `413` and rolls back the entire run so reviewers never receive a partial register.

The current parser recognizes clearly labeled, text-extractable DD Form 1423 content. Scanned forms, complex merged tables, handwritten content, and degraded OCR remain future validation work.

## Inventory states and optional review history

- `PENDING` (**As extracted**): active and immediately included in proposal analysis; no reviewer action is required.
- `VALIDATED` (**Reviewer confirmed**): optionally reviewed against the cited source and retained in the audit history.
- `DISMISSED` (**Excluded**): reviewed and removed from proposal analysis; a reason is mandatory.

Every optional review mutation appends a decision containing the reviewer label, timestamp, before and after state, and note. The local prototype does not yet authenticate that reviewer label against a Windows identity, so it is an audit aid rather than a nonrepudiation control.

Each review save also carries the requirement version the reviewer loaded. If another tab or process has already changed that record, the API rejects the stale save without adding a decision, and the interface reloads the current requirement for a fresh review.

## Current limitations

- Rules prioritize traceability and deterministic behavior over complete natural-language interpretation.
- Compound obligations are split only when a repeated mandatory term makes the boundary sufficiently clear.
- Source page coordinates, table-cell geometry, OCR, amendment precedence, incorporated-reference retrieval, and classified-document handling are not yet implemented.
- Requirement confidence is a rules-engine score, not a probability or a model guarantee.
- The crosswalk compares every active requirement (`PENDING` and `VALIDATED`) with candidate proposal evidence. Untouched current findings do not require human confirmation; manual overrides and exceptions do.
- This prototype is not approved for real CUI, ITAR-controlled technical data, classified material, source-selection information, or proprietary customer proposals.

Automated coverage is an evidence-backed screening result, not a legal, contractual, or contracting-officer compliance determination. Human reviewers remain responsible for source ambiguities, overrides, exceptions, and the final proposal decision.
