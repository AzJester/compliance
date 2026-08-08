<!-- markdownlint-disable MD013 -->

# Requirements Register

The Phase 2 requirements register converts solicitation text extracted inside the running workstation or container into traceable candidate obligations for human review. It is a rules-based baseline: it does not call an external AI or reference service, load a remote model, dereference solicitation links, or transmit document content outside the application boundary.

## Review workflow

1. Create a project and upload the solicitation package from the **Documents** view.
2. Resolve any extraction errors or scanned documents marked `NEEDS_OCR`.
3. Select **Extract requirements** to analyze eligible, nonduplicate documents.
4. Review the complete register and the dedicated Section L, Section M, and CDRL views.
5. Correct the normalized requirement text or classification when necessary.
6. Validate supported candidates or dismiss false positives with a required explanation.
7. Rerun extraction after adding documents. Stable candidates retain reviewer edits and decisions.

All candidates begin in `PENDING` state. A candidate is not authoritative merely because the application extracted it. Source documents and the solicitation control whenever a candidate conflicts with the source.

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

Section L and Section M are presented as dedicated registers. Section L focuses on proposal organization, content, format, limits, delivery, deadlines, and other instructions to offerors. Section M focuses on evaluation factors, subfactors, relative importance, rating language, award basis, and evaluation risk. Reviewers should still inspect requirements from all other sections.

## Provenance rules

The application preserves immutable source text and character offsets separately from the reviewer-editable normalized requirement. It reports only locators supported by local extraction metadata, such as a PDF page, Word paragraph, worksheet row, slide, line, or character range. If the extractor cannot establish a locator, the interface says so instead of inventing one.

Requirement fingerprints are derived deterministically from source identity and location. Repeating analysis against unchanged documents reuses the same records. Reviewer edits, validation states, dismissal reasons, and decision history survive a rerun.

Duplicate document occurrences remain visible in the document manifest for package provenance but are analyzed only once within a project.

## CDRL register

The CDRL register preserves the available DD Form 1423 header fields (Blocks A–F) and item fields (Blocks 1–18), including full Block 14 distribution information and Block 16 remarks or DID tailoring. Values are retained as source text so leading zeros, schedules, copy counts, and contractual wording are not changed by type coercion.

Readiness treats each active CDRL as a separate human-review gate. A complete, current record must be marked reviewed; an incomplete record requires an explicit reviewer waiver with a nonblank reason. Source or document-role changes make earlier adjudication stale. Records classified **Reference only** remain available as context but do not create active requirements or count toward readiness.

Missing or ambiguous fields remain empty and require human review. The rules engine does not infer a DID, delivery date, approval code, distribution statement, or other contractual value that is not present in the extracted source.

Colon-delimited labels and tab-separated label/value cells are recognized. To keep hostile or malformed documents from producing unbounded API and browser payloads, one CDRL source span is capped at 32,000 characters and is explicitly marked as source-capped and incomplete when that limit is reached.

Candidate counts are also bounded before database writes. The default limits are 5,000 requirements and 500 CDRLs per document, and 20,000 requirements and 2,000 CDRLs per extraction run. Administrators can lower these values with the documented `COMPLIANCE_MAX_*_CANDIDATES_*` environment settings. Exceeding a limit returns `413` and rolls back the entire run so reviewers never receive a partial register.

The current parser recognizes clearly labeled, text-extractable DD Form 1423 content. Scanned forms, complex merged tables, handwritten content, and degraded OCR remain future validation work.

## Validation states and history

- `PENDING`: extracted but not yet accepted by a reviewer.
- `VALIDATED`: reviewed against the cited source and accepted.
- `DISMISSED`: reviewed and rejected as a requirement; a reason is mandatory.

Every review mutation appends a decision containing the reviewer label, timestamp, before and after state, and note. The local prototype does not yet authenticate that reviewer label against a Windows identity, so it is an audit aid rather than a nonrepudiation control.

Each review save also carries the requirement version the reviewer loaded. If another tab or process has already changed that record, the API rejects the stale save without adding a decision, and the interface reloads the current requirement for a fresh review.

## Current limitations

- Rules prioritize traceability and deterministic behavior over complete natural-language interpretation.
- Compound obligations are split only when a repeated mandatory term makes the boundary sufficiently clear.
- Source page coordinates, table-cell geometry, OCR, amendment precedence, incorporated-reference retrieval, and classified-document handling are not yet implemented.
- Requirement confidence is a rules-engine score, not a probability or a model guarantee.
- The crosswalk compares validated requirements with candidate proposal evidence, but every coverage finding still requires human verification and does not constitute legal or contracting-officer approval.
- This prototype is not approved for real CUI, ITAR-controlled technical data, classified material, source-selection information, or proprietary customer proposals.

Human review of the complete solicitation package remains mandatory.
