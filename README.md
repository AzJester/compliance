# DoD RFP Compliance

<!-- markdownlint-disable MD013 -->

DoD RFP Compliance is a standalone, local-first application for turning Department of Defense solicitation packages into a traceable requirements inventory and comparing every active requirement with cited proposal-response evidence.

The product is intended to help proposal, contracts, and compliance teams find omissions, conflicts, and submission risks without making a reviewer approve every extracted requirement or automated finding.

> **Important:** Automated coverage is an evidence-backed screening result, not a legal, contractual, or contracting-officer compliance determination. Human reviewers remain responsible for overrides, exceptions, and the final decision to submit a proposal.

## Current implementation

The current application includes:

- A loopback-default FastAPI service with an explicit web mode, authenticated-by-default access policy, deliberate anonymous option, and SQLite project persistence.
- Public-data project creation; the UI disables and the API rejects CUI and ITAR projects until a future authorized deployment exists.
- Multi-file PDF, DOCX, XLSX, PPTX, and recursive ZIP intake.
- SHA-256 content-addressed storage with per-occurrence package provenance.
- Local text extraction and scanned-PDF `NEEDS_OCR` detection.
- ZIP and Office-container defenses for traversal, encryption, active content, unsafe compression, excessive size, and excessive nesting.
- A responsive React workspace with a searchable project switcher, a guided three-step workflow, plain-language help, and mobile layouts.
- Editable project metadata, persisted workflow progress, document classification, extracted-text preview, and exact SHA-256 provenance.
- Evidence-backed solicitation-detail detection for the title, solicitation number, issuing agency, proposal deadline, NAICS, PSC/FSC, set-aside, contract type, and points of contact, available when metadata correction is needed.
- Amendment conflict warnings, exact source passages and locators, confidence labels, stale-analysis protection, and atomic approved-value updates.
- Deterministic, versioned requirement extraction with exact source excerpts and offsets.
- Sections A–M classification and dedicated Section L and Section M review registers.
- DD Form 1423/CDRL extraction preserving available Blocks A–F and 1–18, including Block 16 tailoring and completeness cues for exception review.
- Search, filters, rule-confidence metadata, optional reviewer corrections or confirmations, exclusion reasons, and append-only decision history.
- Idempotent reruns that retain reviewed status and normalized requirement edits.
- Atomic proposal-volume ingestion that keeps response evidence out of solicitation extraction.
- Conservative deterministic crosswalk candidates, exact and manually selected proposal citations, correctable manual evidence, numeric/date conflict detection, ownership, deadlines, and audited manual overrides.
- Coverage-oriented readiness scoring, stale-input and evidence blockers, optional compliance-linked corrective actions, JSON/CSV registers, and a six-sheet XLSX compliance workbook.
- Backend and frontend automated tests plus read-only GitHub Actions validation.

The current milestone provides an end-to-end synthetic/PUBLIC demonstration workflow. It is not approved for real proposal, customer, proprietary, CUI, ITAR-controlled, classified, or source-selection data. OCR, complete amendment and incorporated-reference reconciliation, individual identity, multi-user authorization, and production authorization remain future work.

See the [user guide](docs/user-guide.md) for the three-step product workflow, the [development guide](docs/development.md) to run the application locally, the [web deployment guide](docs/deployment.md) for the anonymous PUBLIC/synthetic-only hosted architecture, and the [requirements-register guide](docs/requirements-register.md) for the extraction rules and limitations.

## Use the application

For a local workstation, run `.\scripts\dev.ps1` from PowerShell and open <http://127.0.0.1:5173>. For the anonymous hosted build, open <https://compliance.insightfuldefense.com> after its administrator confirms the deployment checklist. No sign-in is required.

[Start the reviewed Render Blueprint from GitHub](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FAzJester%2Fcompliance) to provision the hosted build. Render shows the paid service and disk for approval before creating them. Merging this repository alone does not make the custom URL live; the Render deployment, DNS record, domain verification, and TLS certificate must also be completed.

Create one project per solicitation and follow three steps:

1. **Solicitation:** upload the solicitation package. The primary document type is selected by default, and the application extracts requirements automatically after upload.
2. **Requirements:** use the complete inventory immediately. Open an item only to correct it, confirm it for the audit trail, or exclude a false positive; none of those actions is a prerequisite for proposal analysis.
3. **Proposal compliance:** upload the synthetic proposal. The application automatically compares it with every active requirement, shows covered items and gaps, and makes exports available in the same workspace.

Reviewer confirmation is required only when a person changes an automated result or records another exception. Partial, missing, conflicting, stale, or unsupported findings still need attention before anyone relies on the assessment.

## Remaining roadmap

- OCR scanned PDFs and provide a verified OCR-review queue.
- Reconcile amendment precedence, superseded language, questions and answers, and incorporated references.
- Add structured Section L volume/page-limit fields and Section M factor hierarchy/relative-importance models.
- Add authenticated multi-user ownership, identity-bound audit records, retention, deletion, and administrator controls.
- Add an approved deployment profile and operating controls for non-public information.

## Standalone and web security model

The default release mode is a single-user local web application bound to the workstation loopback interface. Document extraction and search run in the application process; the application sends no document content or telemetry to an AI or external reference service.

An explicit web mode packages the frontend and API in one container and requires exact HTTPS origin and host settings. Web access defaults to shared HTTP Basic authentication, but the Render Blueprint deliberately sets `COMPLIANCE_WEB_ACCESS_MODE=anonymous` for the intended address, <https://compliance.insightfuldefense.com>. No sign-in, user identity, authorization, privacy boundary, ownership check, role, or tenant isolation protects that deployment. Anyone who can reach either public hostname can use the UI and API to create, list, read, and change project records and submit uploads. Intake limits reduce individual request size but do not prevent abuse, resource exhaustion, or disclosure to another visitor. Use only synthetic material or independently confirmed PUBLIC sources; never upload customer, non-public solicitation, source-selection, real proposal, proprietary, CUI, ITAR-controlled, or classified information. See the [web deployment guide](docs/deployment.md) before enabling it.

This architecture may support a CUI/ITAR-controlled environment, but installing the application does not itself make a workstation or organization compliant with NIST SP 800-171, CMMC, export-control rules, or contractual security obligations. The full system boundary, configuration, policies, and operating environment must be assessed and authorized by the responsible organization.

Classified information is outside the scope of the first release.

## Documentation

- [User guide](docs/user-guide.md): follow the three-step solicitation, requirements-inventory, and proposal-assessment workflow.
- [Development guide](docs/development.md): install dependencies, launch the local workstation build, and run validation.
- [Web deployment guide](docs/deployment.md): publish the anonymous PUBLIC/synthetic-only prototype with persistent storage and HTTPS, and understand its open-access risks.
- [Requirements-register guide](docs/requirements-register.md): taxonomy, provenance, extraction, CDRL fields, and review history.
- [Application plan](docs/application-plan.md): product workflow, architecture, data model, security boundary, delivery phases, and acceptance criteria.

## Repository data policy

This is a public repository. Do not commit solicitation data, proposal content, customer information, credentials, CUI, ITAR-controlled technical data, export-controlled material, or classified information.
