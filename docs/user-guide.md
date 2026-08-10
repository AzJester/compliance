<!-- markdownlint-disable MD013 -->

# User Guide

This guide covers the application's three-step workflow: upload a solicitation, use the automatically extracted requirements inventory, and upload a synthetic proposal for an automatic evidence-backed coverage assessment.

> **Important:** Automated coverage is a screening result, not a legal, contractual, or contracting-officer compliance determination. The application helps a proposal team find omissions and conflicts; it does not approve the proposal. Human reviewers remain responsible for manual overrides, genuine exceptions, legal interpretation, and the final submission decision.

## Data-use boundary

The hosted application is an anonymous shared demonstration. Use only synthetic material or independently confirmed **PUBLIC data**. Never upload a real proposal, customer data, proprietary information, non-public solicitation material, source-selection information, credentials, CUI, ITAR-controlled technical data, or classified information.

There is no sign-in, privacy boundary, ownership check, role, tenant isolation, or verified identity. Anyone who reaches the application can list, read, create, and change shared records. Uploads persist on shared storage and there is no user-facing deletion workflow. Reviewer labels describe who someone claims performed a review; they are not authenticated identities.

Running the software on a web server does not make that server suitable for controlled government information. A real controlled-data deployment requires an organization-approved system boundary and separate authorization that this release does not provide.

## Open the application

For local use, follow the [development guide](development.md) and open <http://127.0.0.1:5173>. The hosted address is <https://compliance.insightfuldefense.com>. No username or password is required for the hosted demonstration.

The header should report **Service online**. If it reports that the service is unavailable, refresh once and ask the administrator to inspect the health endpoint and service logs.

## Follow the guided workflow

Each project has three stages:

1. **Solicitation** uploads the source package and automatically extracts its requirements.
2. **Requirements** lists the complete inventory immediately. Reviewer correction, confirmation, or exclusion is optional exception work, not a gate.
3. **Proposal compliance** uploads the response, automatically generates the crosswalk, surfaces gaps, and provides the coverage summary and exports.

The workflow rail and recommended-next-action bar show where to continue. You do not have to approve each requirement or each automatically covered finding before moving forward.

## Create a project

Select **New project** and complete the wizard:

1. Enter a descriptive project name.
2. Add the solicitation number and agency or customer when known.
3. Add the proposal due date and verify the displayed local time zone.
4. Confirm that only synthetic PUBLIC data will be used.
5. Select **Create project**.

Use one project for one solicitation package. Sensitivity remains PUBLIC in this release.

## 1. Upload the solicitation

Open **Solicitation**, choose or drag files into **Import documents**, acknowledge the PUBLIC-data boundary when prompted, and upload them. **Solicitation document** is the default document type, so a normal base-solicitation upload needs no extra classification step.

Supported formats are:

- Searchable PDF (`.pdf`)
- Microsoft Word Open XML (`.docx`)
- Microsoft Excel Open XML (`.xlsx`)
- Microsoft PowerPoint Open XML (`.pptx`)
- ZIP packages (`.zip`), including supported documents in nested ZIP files

Legacy Office files (`.doc`, `.xls`, and `.ppt`) are not supported. Password-protected archives, executable content, unsafe archive paths, active Office content, unsafe compression ratios, excessive nesting, and configured size or item limits are rejected.

The local defaults are 100 files per request, 100 MiB per file, and 500 MiB per request. The hosted Blueprint uses lower limits: 10 files, 20 MiB per file, and 50 MiB per request.

Use a different document type when the source is not the primary solicitation:

- **Amendment** for formal changes that may supersede earlier text.
- **Attachment or exhibit** for a PWS, SOW, specification, or other attachment.
- **CDRL / DD Form 1423** for contract data requirement lists and related forms.
- **Questions and answers** for government answers or bidder questions.
- **Reference only** for context that should not create requirements or proposal evidence.

Upload files with different document types in separate batches. You can later select **Classify** on a manifest row to correct a type. Add a short note when version, precedence, or package context matters.

After a non-reference batch is uploaded, the application automatically runs requirement extraction and opens **Requirements**. There is no separate package-verification or candidate-approval stage. If automated extraction fails, the files remain uploaded and the interface tells you to retry from the requirements inventory.

The manifest preserves the original file and its SHA-256 provenance. Use **View text** to inspect extracted text and **Copy full SHA-256** to copy the complete integrity hash. Important processing states are:

- **Extracted**: text is available for deterministic analysis.
- **Needs OCR**: the PDF appears scanned and cannot be analyzed by this release.
- **Archive expanded**: the ZIP is registered and accepted contents appear as separate rows.
- **Error**: extraction failed and needs attention.

A duplicate remains visible for package provenance but is not analyzed twice within the same project. Scanned, corrupted, misclassified, or ambiguous source files are exceptions that still need human attention.

## 2. Use the requirements inventory

The **Requirements** stage shows every extracted requirement by default. The application uses deterministic, versioned rules inside the running process; it does not send document content to an external model or follow embedded links.

Focused views are available without changing the underlying inventory:

- **All requirements** covers Sections A–M and unknown sections.
- **Section L** focuses on proposal organization, content, format, page limits, delivery, and deadlines.
- **Section M** focuses on factors, subfactors, relative importance, award basis, and rating language.
- **CDRLs** preserves available DD Form 1423 Blocks A–F and 1–18, including Block 16 tailoring.

Use summary filters, search, sorting, and pagination to narrow the register. The status labels mean:

- **As extracted** (`PENDING`): available for proposal analysis immediately; no reviewer action is required.
- **Reviewer confirmed** (`VALIDATED`): optionally checked against the source and retained in the audit history.
- **Excluded** (`DISMISSED`): omitted from proposal analysis because a reviewer identified a false positive or inapplicable record.

Do not open 1,250 requirements simply to approve them. Open an item only when you need to:

- Correct the normalized text, section, category, obligation owner, or applicability.
- Confirm a high-risk item for the audit trail.
- Exclude a false positive with a reason.

A reviewer label is required when saving one of those human decisions. The source document always controls if the normalized record conflicts with it. Review history is append-only, and a stale concurrent save is rejected so one reviewer cannot silently overwrite another.

Use **Refresh requirements** after adding or reclassifying solicitation documents. Stable records retain reviewer edits and decisions. A substantive correction or an exclude/reopen decision makes an earlier proposal finding stale until the proposal is reanalyzed; merely confirming an unchanged requirement does not.

The CDRL view shows missing or ambiguous DD Form 1423 fields so a reviewer can investigate real exceptions. Those cues do not create a blanket requirement to adjudicate every CDRL before proposal analysis. The rules engine never invents a DID, delivery date, approval code, distribution statement, or other contractual value that is absent from the source.

## 3. Upload and assess the proposal

Open **Proposal compliance**, optionally enter a proposal volume or upload-group name, select one or more synthetic PUBLIC proposal files, acknowledge the disclosure boundary, and select **Upload and analyze proposal**.

Proposal files are classified atomically as **Proposal response** and excluded from solicitation requirement extraction. After upload, the application automatically compares the proposal with every active requirement—both **As extracted** and **Reviewer confirmed** records—and generates an evidence-backed finding. Only **Excluded** requirements are omitted.

The assessment uses these statuses:

- **Covered**: cited proposal evidence appears to address the requirement.
- **Partial**: related evidence exists but appears incomplete.
- **Missing**: no adequate proposal evidence was found.
- **Conflict**: the response appears to contain a conflicting number, date, or condition.
- **N/A**: the requirement has been determined not to apply to the response.

The crosswalk opens with **Needs attention**, which includes partial, missing, conflicting, stale, unsupported-evidence, and unconfirmed-override findings. Use **Covered** or **All** when you want to inspect successful matches. Candidate scores rank textual similarity; they are not probabilities or compliance guarantees.

No reviewer confirmation is required for an untouched, current automated finding with valid evidence. Human review is required when a person overrides the candidate status, changes evidence, documents N/A or another exception, or resolves an ambiguous or unsupported finding. A manual status override requires both a reviewer label and confirmation that the cited evidence was checked.

When automated evidence is incomplete, select **Add source passage**, choose a proposal volume, highlight the exact passage in the source viewer, and add it as a manual citation. A mistaken manual citation can be removed. Automated candidate evidence is replaced by reanalyzing the proposal rather than edited in place.

Use **Reanalyze proposal** after a requirement or source document changes. Current automated findings are preserved when their inputs remain unchanged; affected findings become stale and are regenerated.

### Read the coverage summary

The coverage summary reports requirements found and assessed, covered and not-applicable items, and partial, missing, or conflicting gaps. The **Reviewer-confirmed (optional)** count is informational; it is not a completion target.

Items needing attention are limited to meaningful exceptions such as missing inputs, stale analysis, invalid or missing evidence, partial or missing coverage, conflicts, and unaudited manual overrides. The optional **Action register** can assign real remediation work without turning every requirement into a task.

Available downloads are:

- A six-sheet XLSX compliance workbook containing Requirements, Section L, Section M, CDRLs, Crosswalk, and Readiness sheets.
- CSV and JSON exports for each individual register.

Exports are snapshots of the current application state, not signed approvals or immutable records. Spreadsheet cells are escaped to prevent formula execution from imported text.

## Persistence, backup, and recovery

Projects, metadata, extracted text, workflow state, optional review history, findings, actions, and immutable uploaded blobs persist in the configured data directory. A developer launch defaults to repository-local `.data/`; the packaged deployment uses the persistent path documented in the [deployment guide](deployment.md).

Back up the entire data directory as one unit. It contains both SQLite data and content-addressed files. For a consistent file-level backup:

1. Stop the application so no write is in progress.
2. Copy the entire data directory to approved protected storage.
3. Record the application version and backup timestamp.
4. Restart the application and verify its health endpoint.
5. Test restoration periodically in an isolated environment.

Treat backups as at least as sensitive as their source. Do not place runtime data in this public repository or an unapproved synchronized folder.

## Current limitations

- No OCR for scanned PDFs.
- Amendment precedence, superseded-language resolution, and incorporated-reference reconciliation still require human review when the sources conflict or are ambiguous.
- Section L and M registers use extracted text and optional reviewer classification; structured volume/page-limit and factor-hierarchy models remain future work.
- Register pagination is currently performed in the browser after retrieval.
- The hosted deployment has no sign-in, privacy, ownership, roles, tenant isolation, verified identities, or user-facing deletion/retention workflow.
- Anonymous visitors can read and change all records and can attempt storage or compute abuse.
- The application is not authorized for real proposals, proprietary data, CUI, ITAR-controlled data, classified information, or source-selection material.

Human review remains necessary for genuine exceptions and the final proposal decision. It is not a requirement-by-requirement approval queue, and the automated coverage summary does not constitute legal or contracting-officer approval.
