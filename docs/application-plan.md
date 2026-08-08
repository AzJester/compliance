# Standalone DoD RFP Compliance Application Plan

<!-- markdownlint-disable MD013 -->

## 1. Product objective

Build a standalone-first application that ingests a complete Department of Defense solicitation package and a contractor's written response, converts both into traceable structured data, and produces an evidence-backed compliance crosswalk.

The application will:

- Default to one approved Windows workstation with its web interface bound only to `127.0.0.1`.
- Permit a separate, explicit single-instance hosted mode for PUBLIC-data demonstrations only; require HTTPS, authentication, exact hosts and origins, and persistent storage.
- Perform OCR, extraction, search, and model inference inside the approved application boundary without sending documents, prompts, analytics, or telemetry to an external AI or reference service. The current hosted prototype uses deterministic extraction and no model inference.
- Support searchable and scanned PDF, DOCX, XLSX, PPTX, and nested ZIP packages.
- Recognize the uniform contract structure described by [FAR 15.204-1](https://www.acquisition.gov/far/15.204-1), including Section L proposal instructions and Section M evaluation factors.
- Extract candidate requirements from the solicitation, attachments, exhibits, amendments, and documents incorporated by reference.
- Preserve exact document, page, paragraph, table, and spreadsheet-cell citations for every extracted requirement.
- Compare each human-validated requirement with evidence from one or more proposal volumes.
- Assign `Compliant`, `Partial`, `Missing`, `Conflicting`, `Not Applicable`, or `Needs Human Review` status.
- Suggest corrective actions or language without silently rewriting the proposal.
- Export an Excel compliance workbook, a Word review report, and a versioned JSON archive.

The application is an advisory and traceability system. It cannot guarantee legal or contractual compliance, and it cannot replace final review by proposal management, contracts, security, export-control, pricing, or legal personnel.

## 2. Success criteria

A proposal review is successful when the system can demonstrate that:

- Every imported document, page, worksheet, attachment, exhibit, and amendment has a processing status.
- Every candidate mandatory statement is represented as an atomic requirement or has been explicitly dismissed by a reviewer with a reason.
- Section J listings reconcile with the files actually received.
- Every CDRL, Section L instruction, and Section M factor has been validated by a human.
- Every compliance conclusion is supported by a solicitation citation and, when applicable, a proposal citation.
- Missing files, unresolved references, submission failures, conflicts, and low-confidence extraction results remain visible until resolved.
- The final exports reproduce the reviewed state and its audit history.

The application must never report that a proposal is fully compliant merely because no additional requirements were found by an AI model.

## 3. End-to-end workflow

### 3.1 Create a project

The user creates a project and records:

- Solicitation number and title.
- Issuing agency or component.
- Solicitation issue date.
- Proposal and questions deadlines, including time zones.
- Internal opportunity identifier.
- Expected information sensitivity.
- Project owner and review status.

The sensitivity selection controls warnings and export behavior. Classified information is rejected because it is outside the first-release security boundary.

### 3.2 Import the solicitation package

The user imports the base solicitation, attachments, exhibits, amendments, and question-and-answer files. The ingestion service will:

1. Expand ZIP files in an isolated working directory.
2. Reject path traversal, executable content, encrypted archives, suspicious compression ratios, and unsupported or corrupted files.
3. Calculate a SHA-256 hash for every file and preserve the original as an immutable source artifact.
4. Identify duplicates and files that have changed between package versions.
5. Extract text, headings, lists, tables, headers, footers, page coordinates, worksheet names, cells, slide notes, and embedded images.
6. Apply local OCR to scanned pages and record OCR confidence.
7. Detect Sections A–M, attachment and exhibit boundaries, forms, and document cross-references.
8. Build a package manifest and reconcile it against Section J and amendment attachment lists.

Missing, duplicate, password-protected, corrupted, and unreferenced files become findings rather than being silently ignored.

### 3.3 Resolve amendments

Each amendment is stored as an ordered overlay on the base solicitation. The application will:

- Identify added, deleted, and replaced text.
- Retain both prior and current language for audit purposes.
- Record which amendment created or superseded each requirement.
- Highlight ambiguous replacements and conflicting amendment instructions.
- Invalidate affected crosswalk findings until the proposal is reanalyzed.
- Require the user to confirm amendment order and completeness.

### 3.4 Extract and validate requirements

Rules and a local structured-output model identify candidate requirements. Compound statements are divided into atomic obligations so that each can be evaluated independently.

Every requirement record contains:

- Stable requirement ID.
- Exact source text.
- Source document, section, page, paragraph, table, cell, and page coordinates.
- Requirement category and subcategory.
- Mandatory term, such as `shall`, `must`, `will`, `required`, or `submit`.
- Obligation owner: offeror, contractor, subcontractor, government, or informational.
- Solicitation-phase, proposal-phase, or post-award applicability.
- Dates, frequencies, quantities, formats, approvals, acceptance conditions, and dependencies.
- Source amendment and effective package version.
- Extraction method, rule/model version, and confidence.
- Human-validation state and reviewer history.

Users can approve, edit, split, merge, recategorize, or dismiss a candidate. Dismissals require a reason. AI-generated records remain unvalidated until a human acts on them.

### 3.5 Import and analyze the proposal

The user imports all proposal volumes and supporting files. The application will:

1. Map files to the required Section L volume structure.
2. Check file names, formats, sizes, page limits, section order, and other mechanical submission rules.
3. Index proposal content with exact-term search, BM25 retrieval, local embeddings, and solicitation identifiers.
4. Retrieve the strongest candidate evidence for each validated requirement.
5. Use a local model to evaluate whether that evidence fully, partially, or inconsistently addresses the requirement.
6. Detect conflicting commitments across proposal volumes, including dates, staffing levels, quantities, technical claims, and assumptions.
7. Present the requirement, proposal evidence, status, rationale, confidence, and suggested action together.

Users accept or override findings, attach additional evidence, assign an owner, set a resolution date, and record notes. Replacing one proposal volume reruns only impacted comparisons while retaining prior results for change review.

### 3.6 Complete the review

The application will not permit a `Review Complete` status while any of the following remain:

- Unvalidated mandatory requirements.
- Missing Section J files or unprocessed amendments.
- Unreviewed CDRLs.
- Unresolved Section L submission failures.
- Missing evidence for mandatory or high-priority Section M criteria.
- Conflicting proposal commitments.
- Blocking findings or low-confidence results awaiting human review.

## 4. Requirements taxonomy

### 4.1 Sections A–K

Capture requirements from the full solicitation, not just Sections L and M:

- Section A: solicitation and contract form data, identifiers, dates, and signatures.
- Section B: CLIN/SLIN structure, products or services, quantities, units, pricing types, options, and cost/price schedules.
- Section C: SOW, PWS, SOO, specifications, outcomes, tasks, technical thresholds, objectives, interfaces, and standards.
- Section D: packaging, preservation, marking, labeling, and shipment requirements.
- Section E: inspection, test, quality, acceptance, warranty, surveillance, and QASP requirements.
- Section F: deliveries, milestones, periods and places of performance, options, and schedules.
- Section G: contract administration, invoicing, payment, accounting, reporting, and points of contact.
- Section H: special contract requirements, security, staffing, transition, travel, property, and local terms.
- Section I: FAR, DFARS, agency-supplement, local, alternate, and deviation clauses.
- Section J: attachments, exhibits, CDRLs, DIDs, forms, specifications, and referenced documents.
- Section K: representations, certifications, registrations, disclosures, signatures, and responsibility information.

### 4.2 Section L register

Create a dedicated register for all instructions, conditions, and notices to offerors:

- Required volumes, parts, tabs, sections, and response order.
- Required content, cross-reference matrices, and completed forms.
- Page, word, slide, attachment, and file-size limits.
- Font, margin, paper-size, line-spacing, color, and printing rules.
- File names, formats, encryption rules, media, copy counts, and packaging.
- Submission portals, email addresses, physical destinations, and addressees.
- Proposal deadline, time zone, questions deadline, and late-submission rules.
- Cost and price instructions, supporting data, and spreadsheet templates.
- Past-performance questionnaires and reference instructions.
- Resumes, key-personnel commitments, letters of commitment, and staffing matrices.
- Assumptions, exceptions, OCI disclosures, representations, and certifications.
- Oral presentations, demonstrations, sample tasks, and scenario responses.
- Security, marking, redaction, proprietary-data, and distribution instructions.

Each instruction maps to the responsible proposal file, section, owner, validation rule, and completion status.

### 4.3 Section M register

Create a dedicated evaluation register containing:

- Evaluation factors and subfactors.
- Relative importance, order, weights, and tradeoff language.
- Pass/fail, responsibility, and eligibility criteria.
- Adjectival, numeric, confidence, and risk rating schemes.
- Technical, management, staffing, transition, past-performance, security, small-business, and cost/price factors.
- Evaluation dependencies and referenced Section L instructions.
- Proposal locations addressing each factor.
- Strength of coverage, discriminators, unsupported claims, and evaluation risk.

The system should distinguish basic compliance from persuasive evaluation coverage. A technically compliant answer may still be weak against a heavily weighted factor.

### 4.4 Contract Data Requirements Lists

[DD Form 1423](https://www.esd.whs.mil/Directives/forms/dd1000_1499/DD1423/) is the Contract Data Requirements List. [DFARS 204.7101](https://www.acquisition.gov/dfars/204.7101-definitions.) treats the DD Form 1423 as an exhibit that establishes requirements for deliverables.

For each CDRL, capture:

- Block A: Contract Line Item Number.
- Block B: Exhibit identifier.
- Block C: Category, including TDP, TM, or other.
- Block D: System or item.
- Block E: Contract or purchase-request number.
- Block F: Contractor.
- Block 1: Data item number.
- Block 2: Title of data item.
- Block 3: Subtitle.
- Block 4: Authority or Data Acquisition Document/DID number and revision.
- Block 5: Contract, SOW, PWS, or specification reference.
- Block 6: Requiring office.
- Block 7: DD Form 250 requirement.
- Block 8: Approval code.
- Block 9: Distribution statement.
- Block 10: Frequency.
- Block 11: As-of date.
- Block 12: Date of first submission.
- Block 13: Date of subsequent submissions.
- Block 14: Distribution, addressees, draft/final copies, media, and delivery method.
- Block 15: Total quantity.
- Block 16: Remarks and DID tailoring.
- Block 17: Price group.
- Block 18: Estimated total price.

Also capture government review periods, approval and comment cycles, resubmission deadlines, acceptance rules, markings, classification or distribution constraints, delivery media, recurring events, and dependencies on milestones, CLINs, or other CDRLs.

Each CDRL links to its governing DID, work requirement, proposal acknowledgment, schedule commitment, responsible organization, and delivery event. Missing DIDs, incomplete Block 16 tailoring, and contradictory dates become findings.

### 4.5 Other requirement classes

Create structured registers for:

- Non-CDRL deliverables, reports, meetings, reviews, invoices, and recurring submissions.
- Technical capabilities, performance thresholds/objectives, interfaces, standards, certifications, demonstrations, verification, and acceptance.
- Staffing, labor categories, qualifications, clearances, key personnel, work hours, locations, surge, travel, materials, and basis-of-estimate obligations.
- Milestones, transition, mobilization, schedules, dependencies, and government-furnished prerequisites.
- FAR, DFARS, agency supplements, local clauses, alternates, deviations, and incorporated references.
- Cybersecurity, CUI, FCI, incident reporting, CMMC, NIST, supply-chain, prohibited-source, and telecommunications requirements.
- ITAR/export-control, NOFORN, distribution statements, dissemination limitations, and marking rules.
- DD Form 254 and classified-performance indicators; classified content triggers a stop notice rather than ingestion.
- Intellectual property, technical data, software rights, licenses, assertion tables, restrictive markings, and deferred delivery or ordering.
- Government-furnished property, equipment, information, facilities, and property-accountability obligations.
- Inspection, quality, configuration management, warranty, packaging, shipping, and acceptance.
- Past performance, corporate experience, OCI, responsibility, financial capability, insurance, and bonding.
- Small-business goals, subcontracting plans, workshare, consent, reporting, and mandatory flowdowns.
- Representations, certifications, registrations, disclosures, signatures, and organizational eligibility.
- Assumptions, exceptions, ambiguities, risks, dependencies, and questions for the contracting officer.

## 5. Compliance evaluation

### 5.1 Status model

- `Compliant`: cited proposal evidence fully addresses the atomic requirement.
- `Partial`: evidence addresses only part of the requirement or lacks a required detail.
- `Missing`: no adequate proposal evidence was found.
- `Conflicting`: the proposal contradicts the solicitation or another proposal statement.
- `Not Applicable`: a reviewer has documented why the requirement does not apply.
- `Needs Human Review`: confidence is insufficient or applicability requires expert judgment.

No finding can be marked `Compliant` without cited proposal evidence and a stored evaluation rationale. `Not Applicable` and overrides require reviewer identity, timestamp, and justification.

### 5.2 Finding fields

Each finding includes:

- Requirement and source citations.
- Best matching proposal evidence and citations.
- Status and confidence.
- Concise rationale.
- Missing elements or conflicts.
- Severity: blocking, high, medium, or informational.
- Assigned owner and target resolution date.
- Suggested corrective action or draft language.
- Reviewer disposition and audit history.

### 5.3 Outputs

The Excel workbook will include:

- `Summary`
- `Requirements`
- `Section L`
- `Section M`
- `CDRLs`
- `Clauses`
- `Deliverables`
- `Risks`
- `Amendment Changes`
- `Review History`

The Word report will include an executive summary, blocking issues, partial responses, evaluation weaknesses, CDRL exposure, contradictions, and cited recommendations. JSON will preserve the complete versioned project schema for backup, restoration, or future integrations.

## 6. Technical architecture

### 6.1 Application components

Use a modular monolith for the first release:

- React and TypeScript browser interface.
- Python and FastAPI local API.
- Background analysis worker with persisted job state.
- SQLite for structured data and FTS5 for exact/full-text search.
- Project-specific filesystem repository for immutable originals and normalized artifacts.
- PyMuPDF plus OCRmyPDF/Tesseract for PDF processing.
- Direct OOXML parsers for DOCX, XLSX, and PPTX so Microsoft Office is not required.
- `llama.cpp` for local inference with a signed, swappable, quantized 8B-class instruction model suitable for a 32 GB CPU-only workstation.
- A local ONNX embedding model combined with BM25 retrieval.
- JSON Schema-constrained model output; invalid results are rejected and retried.
- Windows installer containing the UI, API, workers, OCR dependencies, and model-management interface.

The processing sequence is:

`Package validation -> extraction/OCR -> structural segmentation -> amendment resolution -> candidate extraction -> atomic normalization -> human validation -> proposal evidence retrieval -> compliance evaluation -> human adjudication -> export`

Deterministic rules and templates handle high-precision structures such as clauses, dates, CDRL forms, section boundaries, and file constraints. The local model handles language variation, semantic matching, requirement splitting, and suggested corrections. Model conclusions must cite extracted source spans.

### 6.2 Core data model

Version the internal API and JSON export as `rfp-compliance/v1`. Principal records are:

- `Project`
- `PackageVersion`
- `SourceDocument`
- `SourceSpan`
- `Requirement`
- `SubmissionInstruction`
- `EvaluationFactor`
- `CDRL`
- `Clause`
- `Deliverable`
- `ProposalArtifact`
- `EvidenceLink`
- `Finding`
- `ReviewDecision`
- `AuditEvent`
- `ReferencePack`

Every derived record retains source-span identifiers, extraction method, rule/model version, confidence, amendment version, creator, reviewer, and timestamps.

### 6.3 Application interfaces

Expose these endpoints on loopback in the default standalone mode:

- Project creation and metadata.
- Package and proposal import.
- Analysis-job submission and status.
- Source-document and citation retrieval.
- Requirement validation and review decisions.
- Crosswalk generation and finding adjudication.
- Export, backup, and restore.
- Reference-pack import and version reporting.
- Health checks and content-free diagnostics.

The optional hosted mode exposes the same UI and API only behind its configured HTTPS origin, exact trusted hosts, and shared authentication. It remains a single-workspace PUBLIC-data demonstration. Remote access to CUI, ITAR-controlled data, classified information, source-selection information, or proprietary proposal content remains outside the first-release scope.

## 7. Security boundary

[NIST SP 800-171 Revision 3](https://csrc.nist.gov/pubs/sp/800/171/r3/final) applies security requirements to components of nonfederal systems that process, store, or transmit CUI, or protect those components. The application must therefore operate within an appropriately controlled and assessed workstation and organizational environment.

Implement for the standalone controlled-data target:

- Loopback-only networking and zero telemetry.
- Windows-user access, NTFS access controls, automatic screen-lock dependency, and least-privilege execution.
- A required BitLocker-protected project volume and approved Windows cryptographic modules.
- Per-project sensitivity metadata and append-only audit events.
- Protected temporary directories with cleanup after processing and startup recovery after interruption.

- CUI banner, portion-marking, dissemination-control, distribution-statement, and export-control detection.
- Explicit warnings and confirmation before copy or export actions.
- Malware scanning through the installed endpoint-security provider.
- Content Security Policy and protection against malicious HTML, links, macros, embedded files, ZIP bombs, and prompt injection contained in documents.
- No automatic execution of links, macros, scripts, or embedded attachments.
- Backup and restoration only to administrator-approved encrypted locations.
- Diagnostics exports that exclude document content by default.

The hosted PUBLIC-data mode is a separate boundary and is not a CUI or ITAR deployment. It requires fail-closed authentication and network settings, a non-root container, reduced resource limits, persistent single-instance storage, and an approved backup and recovery procedure. Moving the container to a web host does not satisfy NIST, CMMC, export-control, contractual, or classified-system requirements.

The system must not be marketed as automatically providing CMMC certification, NIST compliance, or authorization to handle CUI. Those determinations depend on the complete environment, security plan, organizational controls, contract clauses, configuration, and assessment.

## 8. Offline reference and model updates

Regulatory content will not be hard-coded because FAR, DFARS, agency supplements, cybersecurity rules, and DIDs change over time.

Signed offline reference bundles contain:

- Dated FAR, DFARS, and agency-supplement clause metadata.
- DID identifiers and parsing templates.
- CUI category and marking metadata.
- Local model files and inference configuration.
- Extraction rules, schemas, and migrations.
- Publisher identity, version, cryptographic hash manifest, signature, release notes, and minimum compatible application version.

The importer verifies signatures and hashes before installation. Updates are rollback-capable and never silently reinterpret an existing project. A user must explicitly select a newer reference pack and authorize reanalysis.

## 9. Delivery plan

### Phase 0: Corpus and specification — 2 weeks

- Obtain 15–25 representative and legally usable DoD solicitation packages, including scans, CDRLs, spreadsheets, amendments, and multiple proposal volumes.
- Have proposal and contracts subject-matter experts label requirements and expected crosswalks.
- Finalize the taxonomy, schemas, security boundary, and gold-standard evaluation set.

### Phase 1: Secure ingestion foundation — 3 weeks

- Implement project storage, hashing, package manifests, safe ZIP handling, PDF/Office extraction, OCR, citations, and the document viewer.
- Add Section A–M, attachment, and exhibit detection.
- Demonstrate that every citation opens the exact page, table, or spreadsheet cell.

### Phase 2: Requirement and specialized registers — 4 weeks

- Implement atomic requirement extraction and human validation.
- Add Section L, Section M, CDRL, clause, deliverable, schedule, staffing, and security registers.
- Add Section J reconciliation, incorporated-reference handling, and amendment versioning.

### Phase 3: Proposal crosswalk — 4 weeks

- Implement proposal ingestion, hybrid evidence retrieval, compliance statuses, conflict detection, rationale, and suggested fixes.
- Add mechanical submission checks and evaluation-factor coverage analysis.
- Add incremental reanalysis when a response file or amendment changes.

### Phase 4: Review workflow and exports — 3 weeks

- Build dashboards, filters, ownership, due dates, adjudication, completion gates, and Excel/Word/JSON exports.
- Add backup/restore and signed reference-pack installation.

### Phase 5: Validation and hardening — 3–4 weeks

- Perform gold-set accuracy testing, security testing, performance profiling, installer testing, recovery testing, and SME acceptance.
- Produce deployment, administration, CUI-boundary, backup, update, and user-review documentation.

With three engineers plus part-time proposal/contracts and security subject-matter experts, target an internal alpha in 8–10 weeks and a hardened pilot in approximately 16–18 weeks.

## 10. Test and acceptance plan

### 10.1 Accuracy gates

- At least 98% recall for human-labeled mandatory Section L instructions, Section M factors, and CDRLs.
- At least 95% recall for mandatory requirements across the complete gold corpus.
- At least 90% precision after validation rules are applied.
- Every finding has valid solicitation and proposal citations or is explicitly labeled `No evidence found`.
- Every CDRL record preserves all visible DD Form 1423 fields and Block 16 tailoring.
- No requirement is marked compliant without proposal evidence and an evaluation rationale.
- No invented clause text, page citation, DID, CDRL field, or proposal evidence is permitted.

### 10.2 Functional scenarios

Test searchable and scanned PDFs, rotated pages, OCR errors, merged tables, spreadsheets, duplicate files, nested ZIPs, password protection, malformed documents, missing attachments, multiple proposal volumes, superseding amendments, contradictory dates, and modified responses.

Validate:

- Section J reconciliation.
- Section L page, file, format, and deadline checks.
- Section M factor coverage.
- CDRL extraction and DID linkage.
- Clause and incorporated-reference inventory.
- Requirement splitting and human overrides.
- Cross-volume evidence and contradiction detection.
- Amendment delta analysis.
- Export fidelity and JSON round-trip restoration.

### 10.3 Security and operational scenarios

- Verify that analysis produces no outbound network traffic.
- Confirm only the signed local UI can call the local API.
- Test path traversal, decompression bombs, macros, malicious links, prompt injection, corrupted OCR, and oversized input.
- Verify workstation-account separation and project access-control behavior.
- Test interrupted-job recovery, low-disk handling, backup restoration, audit integrity, reference-pack rollback, and uninstall behavior.
- On the baseline 32 GB CPU-only workstation, target 15 minutes for a 500-page searchable package, 45 minutes for a heavily scanned package, and 10 minutes for an incremental proposal rerun.

## 11. Assumptions and limitations

- “L&M requirements” means Sections L and M; labor and material requirements are also captured separately.
- The first release covers DoD negotiated FAR Part 15 RFPs rather than every federal procurement type or Other Transaction agreement.
- The first release is single-user and runs on one approved Windows workstation.
- The maximum intended sensitivity is CUI/ITAR; classified information is rejected.
- Supported inputs are PDF, DOCX, XLSX, PPTX, and ZIP. MSG and EML ingestion are deferred.
- Required outputs are Excel, Word, and JSON.
- The application produces findings and suggested fixes but does not overwrite proposal files automatically.
- All generative analysis runs locally, and routine operation requires no internet connection.
- Regulatory and model updates arrive through signed offline bundles.
- Human reviewers remain accountable for applicability, waivers, legal interpretation, export-control determinations, security obligations, and final proposal approval.
