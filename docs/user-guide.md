<!-- markdownlint-disable MD013 -->

# User Guide

This guide explains the current human-reviewed requirements-register workflow. The application turns text-extractable solicitation documents into candidate requirements; it does not yet compare a proposal response with those requirements or make a final compliance determination.

## Data-use boundary

The current release accepts **PUBLIC data only**. Use synthetic or otherwise approved non-sensitive material. Do not upload CUI, ITAR-controlled technical data, classified information, source-selection information, proprietary proposal content, credentials, or customer data.

Running the software on a web server does not make that server suitable for sensitive government information. Hosting real controlled data requires an organization-approved system boundary and separate security authorization that this release does not provide.

## Open the application

For local use, follow the [development guide](development.md) and open <http://127.0.0.1:5173>. The intended hosted address is <https://compliance.insightfuldefense.com>; use it only after an administrator completes the [deployment checklist](deployment.md#deployment-acceptance-checklist) and confirms that access control is active.

The hosted build first asks for the shared application username and password. The administrator supplies these credentials outside the repository; do not put them in a bookmark, URL, screenshot, or proposal note. The current HTTP Basic sign-in is shared by authorized users and does not identify one person for audit purposes. Close every window in the browser session when finished because browsers can cache Basic credentials.

After sign-in, the header should report that the service is online. If it reports that the service is unavailable, refresh once and then ask the administrator to verify the application health endpoint and logs.

## 1. Create a project

Use one project for one solicitation package:

1. Enter a descriptive project name.
2. Optionally add the solicitation number, agency, and proposal due date.
3. Leave **Sensitivity** set to **Public**. CUI and ITAR projects are intentionally disabled.
4. Select **Create project**.

The due date is interpreted in the time zone shown below the field. Verify it against the solicitation; the application does not resolve conflicting deadlines or amendment precedence yet.

## 2. Upload the solicitation package

Open **Documents**, then drag files into **Import documents** or choose them with the file picker. You can stage multiple files before uploading.

Supported intake formats are:

- Searchable PDF (`.pdf`)
- Microsoft Word Open XML (`.docx`)
- Microsoft Excel Open XML (`.xlsx`)
- Microsoft PowerPoint Open XML (`.pptx`)
- ZIP packages (`.zip`), including supported documents in nested ZIP files

Legacy Office formats such as `.doc`, `.xls`, and `.ppt` are not supported. Password-protected or encrypted archives are rejected. Executable content, unsafe archive paths, active Office content, unsafe compression ratios, excessive nesting, and configured size or item limits are also rejected.

The local-workstation defaults are 100 files per request, 100 MiB per file, and 500 MiB for the whole request. The Render Blueprint deliberately uses lower web limits: 10 files, 20 MiB per file, and 50 MiB per request. An administrator may reduce those values further for a PUBLIC-data deployment.

## 3. Check the document manifest

Do not start requirement review until the manifest matches the package you intended to upload. Check each row for:

- Filename and any path inside an archive
- File type and byte size
- SHA-256 content hash
- Extraction status and extracted character count
- Source archive
- Duplicate indicator

The important extraction states are:

- **Extracted**: text is available for deterministic requirement extraction.
- **Needs OCR**: the PDF appears to be scanned and cannot be analyzed by the current release.
- **Archive expanded**: the ZIP itself is registered and its accepted contents appear as separate rows.
- **Error**: text extraction failed; inspect the displayed error before continuing.

A duplicate remains visible for package provenance but is not analyzed twice within the same project. Use **Refresh** if the manifest is temporarily stale.

## 4. Extract requirements

Open **All Requirements** and select **Extract requirements**. The application analyzes eligible extracted text inside the running workstation or container using deterministic, versioned rules. It does not send documents to an external model or follow links embedded in the solicitation.

The extraction summary distinguishes newly created records from reused records. Running extraction again is safe: unchanged candidates are reused, and prior reviewer edits and decisions are retained.

Every extracted item begins as a candidate in **Pending** state. Extraction does not prove that the item is complete, correctly classified, applicable, or contractually controlling.

## 5. Review the registers

Use the project tabs to divide the review:

- **All Requirements** contains every extracted candidate across Sections A–M and unknown sections.
- **Section L** focuses on instructions to offerors, including organization, content, format, page limits, delivery, and deadlines.
- **Section M** focuses on evaluation factors, subfactors, relative importance, award basis, and rating language.
- **CDRLs** shows candidate DD Form 1423 records with available Blocks A–F and 1–18, including Block 16 remarks and tailoring.

Search and filter the registers to work through pending items. Always compare a candidate with its immutable exact-source excerpt and the original solicitation package. A confidence value is a rules score, not a probability or compliance guarantee.

For each CDRL, expand **View full DD Form 1423 field inventory**. Values marked **Not captured** and fields listed as missing require manual review. Use **Review linked requirement** to record the decision for that delivery record. Do not infer a DID, delivery schedule, approval code, distribution requirement, or other contractual value solely from an empty field.

## 6. Record a review decision

Open a requirement to review it:

1. Read the immutable exact source, source document, and locator.
2. Correct the normalized requirement, section, category, obligation owner, or applicability if necessary.
3. Enter a reviewer name or team label.
4. Add a concise review note when it will help a later reviewer understand the decision.
5. Select **Validate** only after confirming the candidate against the controlling source.
6. To reject a false positive, enter a dismissal reason and select **Dismiss**.

**Save changes** preserves classification edits without changing the current validation state. Each save appends a review-history record with the reviewer, timestamp, before state, after state, and note. If another browser tab changes the same requirement first, the application rejects the stale save and reloads the current record for a fresh review.

The states mean:

- **Pending**: not yet accepted or dismissed by a reviewer.
- **Validated**: a reviewer accepted the candidate against the cited source.
- **Dismissed**: a reviewer rejected the candidate and recorded a reason.

Validation is a human workflow record; it is not legal advice, contracting-officer approval, or a substitute for reading the complete solicitation.

## Persistence, backup, and recovery

Projects, metadata, extracted text, review history, and immutable uploaded blobs persist in the configured application data directory. For a developer launch, the default is the repository-local `.data/` directory. A packaged deployment uses the persistent directory or container volume documented in the [deployment guide](deployment.md).

Back up the whole data directory as one unit. It contains the SQLite database and the content-addressed document store; copying only one of them creates an incomplete backup.

For a consistent file-level backup:

1. Stop the application so no upload, extraction, or review save is in progress.
2. Copy the entire configured data directory to approved protected storage.
3. Record the application version and backup timestamp.
4. Restart the application and verify its health endpoint.
5. Periodically test restoration in an isolated environment using the same application version.

To restore, stop the application, preserve the current data directory for rollback, replace it with the complete known-good backup, start the same application version, and verify project counts plus a sample of document hashes and review history before resuming work.

Treat backups as at least as sensitive as their source documents. Git ignore rules are not access controls. Do not place runtime data in this public repository or in an unapproved cloud-synchronized folder.

## Current limitations

- No proposal-response ingestion or requirement-to-response crosswalk yet
- No OCR for scanned PDFs
- No amendment precedence or incorporated-reference reconciliation
- Hosted mode has one shared HTTP Basic credential, not individual accounts, single sign-on, roles, or identity-bound review records
- No project deletion, retention workflow, compliance export, or supported data migration interface
- No approval for CUI, ITAR-controlled, classified, source-selection, or proprietary proposal data

Human review of every source document and candidate remains mandatory.
