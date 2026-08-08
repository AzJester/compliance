<!-- markdownlint-disable MD013 -->

# User Guide

This guide covers the complete human-reviewed workflow: create a project, verify the solicitation package, extract and adjudicate requirements, add a synthetic proposal response, crosswalk response evidence, resolve gaps, and export the current compliance records.

## Data-use boundary

The hosted application is an anonymous shared demonstration. Use only synthetic material or independently confirmed **PUBLIC data**. Never upload a real proposal, customer data, proprietary information, non-public solicitation material, source-selection information, credentials, CUI, ITAR-controlled technical data, or classified information.

There is no sign-in, privacy boundary, ownership check, role, tenant isolation, or verified identity. Anyone who reaches the application can list, read, create, and change shared records. Uploads persist on shared storage and there is no user-facing deletion workflow. Reviewer labels describe who someone claims performed a review; they are not authenticated identities.

Running the software on a web server does not make that server suitable for controlled government information. A real controlled-data deployment requires an organization-approved system boundary and separate authorization that this release does not provide.

## Open the application

For local use, follow the [development guide](development.md) and open <http://127.0.0.1:5173>. The hosted address is <https://compliance.insightfuldefense.com>. No username or password is required for the hosted demonstration.

The header should report **Service online**. If it reports that the service is unavailable, refresh once and ask the administrator to inspect the health endpoint and service logs.

## Follow the guided workflow

Each project has seven stages:

1. **Setup** records the project, solicitation, agency, and due date.
2. **Files** uploads and classifies the solicitation package.
3. **Verify** records package-completeness checks.
4. **Requirements** extracts and reviews all requirement candidates, including focused Section L, Section M, and CDRL views.
5. **Response** uploads synthetic proposal volumes separately from the solicitation.
6. **Crosswalk** finds candidate response evidence and records human decisions.
7. **Reports** shows readiness, unresolved actions, and exports.

The workflow rail and recommended-next-action bar show where to continue. A green or automated candidate is never a final compliance decision by itself.

## 1. Create and maintain a project

Select **New project** and complete the two-step wizard:

1. Enter a descriptive project name.
2. Add the solicitation number and agency or customer when known.
3. Add the proposal due date and verify the displayed local time zone.
4. Confirm that only synthetic PUBLIC data will be used.
5. Select **Create project**.

Use one project for one solicitation package. To correct its metadata later, open **Setup**, expand **View or edit project details**, and select **Edit project details**. Sensitivity remains PUBLIC in this release.

## 2. Upload and classify solicitation files

Open **Files**, choose or drag files into **Import documents**, acknowledge the PUBLIC-data boundary when prompted, and upload them.

Supported formats are:

- Searchable PDF (`.pdf`)
- Microsoft Word Open XML (`.docx`)
- Microsoft Excel Open XML (`.xlsx`)
- Microsoft PowerPoint Open XML (`.pptx`)
- ZIP packages (`.zip`), including supported documents in nested ZIP files

Legacy Office files (`.doc`, `.xls`, and `.ppt`) are not supported. Password-protected archives, executable content, unsafe archive paths, active Office content, unsafe compression ratios, excessive nesting, and configured size or item limits are rejected.

The local defaults are 100 files per request, 100 MiB per file, and 500 MiB per request. The hosted Blueprint uses lower limits: 10 files, 20 MiB per file, and 50 MiB per request.

For every manifest row, select **Classify** and choose the file role:

- **Base solicitation** for the primary RFP or solicitation.
- **Amendment** for formal changes that may supersede earlier text.
- **Attachment** for a PWS, SOW, exhibit, specification, or other attachment.
- **CDRL / DD Form 1423** for contract data requirement lists and related forms.
- **Questions and answers** for government answers or bidder questions.
- **Reference only** for context that should not become solicitation requirements or proposal evidence.
- **Proposal response** only for synthetic response volumes; normally add these in the Response stage.

Add a short classification note when version, precedence, or package context matters. Use **View text** to inspect the extracted text and **Copy full SHA-256** to copy the complete integrity hash.

Important processing states are:

- **Extracted**: text is available for deterministic analysis.
- **Needs OCR**: the PDF appears scanned and cannot be analyzed by this release.
- **Archive expanded**: the ZIP is registered and accepted contents appear as separate rows.
- **Error**: extraction failed and requires review.

A duplicate remains visible for package provenance but is not analyzed twice within the same project.

## 3. Verify the package

Open **Verify**. For each checklist item, choose one status:

- **Pending review** when the check is not complete.
- **Verified** when the package satisfies the check.
- **Issue found** when a missing file, mismatch, or unresolved condition exists.
- **Not applicable** when the check does not apply, based on human review.

Enter a reviewer or team label and an optional verification note, then save progress. All checks must be Verified or Not applicable, with no Issue found status, before package verification is complete.

Adding or reclassifying solicitation material invalidates affected package verification and readiness. Reconcile the new package state before relying on earlier findings.

## 4. Extract and review requirements

Open **Requirements** and select **Find requirements**. The application analyzes eligible solicitation text inside the running process using deterministic, versioned rules. It does not send document content to an external model or follow embedded links.

Use the focused registers:

- **All requirements** covers Sections A–M and unknown sections.
- **Section L** focuses on proposal organization, content, format, page limits, delivery, and deadlines.
- **Section M** focuses on factors, subfactors, relative importance, award basis, and rating language.
- **CDRLs** preserves all available DD Form 1423 Blocks A–F and 1–18, including Block 16 tailoring.

The default queue emphasizes pending decisions. Use summary filters, search, sorting, and pagination to narrow the register. Select a requirement to open the review panel, then:

1. Compare the candidate with its exact source excerpt, document, and locator.
2. Correct the normalized text, section, category, obligation owner, or applicability when necessary.
3. Enter a reviewer label and useful note.
4. Select **Validate** only after confirming the controlling source.
5. To reject a false positive, record a dismissal reason and select **Dismiss**.

Review history is append-only. A stale concurrent save is rejected and the current record is reloaded. Editing a previously crosswalked requirement invalidates its prior readiness until the crosswalk is regenerated and reviewed again.

For each CDRL, expand its full DD Form 1423 inventory. **Not captured** values and listed missing fields require manual review. Record a reviewer and mark a complete record **Reviewed for completeness**. If a source-supported exception must be accepted, select **Explicitly waived**, enter the reviewer, and document the waiver reason. Incomplete, unreviewed, or source-stale CDRLs block readiness; merely opening a record does not clear it. Do not infer a DID, schedule, approval code, distribution requirement, or contractual value from an empty field.

## 5. Add the proposal response

Open **Response** and enter a volume or upload-group name. Select one or more synthetic PUBLIC proposal files, confirm they are safe for anonymous disclosure, and upload them.

Proposal uploads are classified atomically as **Proposal response** before they become visible to extraction or crosswalk processing. They are excluded from solicitation requirement extraction. If a proposal document is later reclassified as something else, citations from that document no longer support readiness.

## 6. Generate and verify the crosswalk

Open **Crosswalk** and select **Generate crosswalk**. The deterministic matcher evaluates validated requirements against current proposal volumes and assigns a conservative candidate status:

- **Covered**: candidate proposal evidence appears to address the requirement.
- **Partial**: related evidence exists but appears incomplete.
- **Missing**: no adequate candidate evidence was found.
- **Conflict**: the response appears to contain a conflicting number, date, or condition.
- **N/A**: a human reviewer determined the requirement does not apply to the response.

Candidate scores rank textual similarity; they are not probabilities or compliance guarantees. Select each finding, read the requirement and cited proposal passage, then record status, reviewer label, resolution owner, due date, and notes.

When automated evidence is incomplete, select **Add source passage**, choose a proposal volume, highlight the exact passage in the source viewer, and add it as a manual citation. A mistaken manual citation can be removed; removing evidence sends the finding back for review. Automated candidate evidence is replaced by regenerating the crosswalk rather than edited in place. Check **I verified this finding against the cited proposal evidence** only after reviewing the evidence. A reviewer label and valid evidence are required for verified coverage.

Regenerating after source changes preserves human decisions when appropriate and marks affected decisions for re-review when evidence or requirements changed.

## 7. Resolve gaps and export records

Open **Reports** to see readiness percentage, requirement, CDRL, and crosswalk counts, blocking reasons, and the recommended next action. Readiness requires assigned file roles, completed package verification, validated requirements, reviewed or explicitly waived current CDRLs, current proposal evidence, a human-verified finding for every active requirement, and no unresolved partial, missing, or conflict findings. The workflow rail uses these backend readiness decisions; it does not mark a stage complete from document counts alone.

Use the **Action register** to assign a gap or follow-up, optionally link it to the controlling requirement or crosswalk finding, set its owner and due date, and move it through To do, In progress, Blocked, and Done. Completed actions can be shown or hidden. Reviewer and owner labels are unverified text in anonymous mode.

Available downloads are:

- A six-sheet XLSX compliance workbook containing Requirements, Section L, Section M, CDRLs, Crosswalk, and Readiness sheets.
- CSV and JSON exports for each individual register.

Exports are snapshots of the current application state, not signed approvals or immutable records. Spreadsheet cells are escaped to prevent formula execution from imported text.

## Persistence, backup, and recovery

Projects, metadata, extracted text, workflow state, review history, findings, actions, and immutable uploaded blobs persist in the configured data directory. A developer launch defaults to repository-local `.data/`; the packaged deployment uses the persistent path documented in the [deployment guide](deployment.md).

Back up the entire data directory as one unit. It contains both SQLite data and content-addressed files. For a consistent file-level backup:

1. Stop the application so no write is in progress.
2. Copy the entire data directory to approved protected storage.
3. Record the application version and backup timestamp.
4. Restart the application and verify its health endpoint.
5. Test restoration periodically in an isolated environment.

Treat backups as at least as sensitive as their source. Do not place runtime data in this public repository or an unapproved synchronized folder.

## Current limitations

- No OCR for scanned PDFs.
- No automated amendment precedence, superseded-language resolution, or incorporated-reference reconciliation.
- Section L and M registers use extracted text and reviewer classification; structured volume/page-limit and factor-hierarchy models remain future work.
- Register pagination is currently performed in the browser after retrieval.
- The hosted deployment has no sign-in, privacy, ownership, roles, tenant isolation, verified identities, or user-facing deletion/retention workflow.
- Anonymous visitors can read and change all records and can attempt storage or compute abuse.
- The application is not authorized for real proposals, proprietary data, CUI, ITAR-controlled data, classified information, or source-selection material.

Human review of every controlling source, requirement, CDRL, and proposal citation remains mandatory.
