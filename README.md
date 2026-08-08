# DoD RFP Compliance

<!-- markdownlint-disable MD013 -->

DoD RFP Compliance is a standalone, local-first Windows application for turning Department of Defense solicitation packages into a traceable requirements inventory and comparing those requirements with a proposal response.

The product is intended to help proposal, contracts, and compliance teams find omissions, conflicts, and submission risks while preserving a human approval step for every final compliance determination.

## Current implementation

The first working vertical slice now includes:

- A loopback-only FastAPI service with SQLite project persistence.
- Public-data project creation; the UI disables and the API rejects CUI and ITAR projects until a future authorized deployment exists.
- Multi-file PDF, DOCX, XLSX, PPTX, and recursive ZIP intake.
- SHA-256 content-addressed storage with per-occurrence package provenance.
- Local text extraction and scanned-PDF `NEEDS_OCR` detection.
- ZIP and Office-container defenses for traversal, encryption, active content, unsafe compression, excessive size, and excessive nesting.
- A React dashboard for project selection, document upload, and manifest review.
- Deterministic, versioned requirement extraction with exact source excerpts and offsets.
- Sections A–M classification and dedicated Section L and Section M review registers.
- DD Form 1423/CDRL extraction preserving available Blocks A–F and 1–18, including Block 16 tailoring.
- Search, filters, rule-confidence metadata, reviewer edits, validation, dismissal reasons, and append-only decision history.
- Idempotent reruns that retain reviewed status and normalized requirement edits.
- Backend and frontend automated tests plus read-only GitHub Actions validation.

The current milestone establishes a local intake and human-reviewed requirements-register prototype. It is not yet approved for real CUI or ITAR-controlled data. OCR, amendment precedence, incorporated-reference reconciliation, proposal crosswalking, compliance findings, exports, and deployment-control validation remain subsequent phases.

See the [development guide](docs/development.md) to run the application and the [requirements-register guide](docs/requirements-register.md) for the Phase 2 workflow and limitations.

## Planned capabilities

- Ingest searchable and scanned PDFs, Word documents, Excel workbooks, PowerPoint files, and nested ZIP packages.
- Identify solicitation Sections A–M, attachments, exhibits, amendments, and incorporated references.
- Build dedicated registers for Section L instructions, Section M evaluation factors, CDRLs, clauses, deliverables, schedules, staffing, security, and data rights.
- Crosswalk each validated requirement to cited evidence in one or more proposal volumes.
- Report compliant, partial, missing, conflicting, not-applicable, and human-review findings.
- Export a compliance workbook, review report, and machine-readable project archive.

## Standalone security model

The first release is a single-user local web application running only on an approved Windows workstation. Document extraction, search, and future model inference remain local; the application requires no cloud service and sends no document content or telemetry off the workstation.

This architecture may support a CUI/ITAR-controlled environment, but installing the application does not itself make a workstation or organization compliant with NIST SP 800-171, CMMC, export-control rules, or contractual security obligations. The full system boundary, configuration, policies, and operating environment must be assessed and authorized by the responsible organization.

Classified information is outside the scope of the first release.

## Documentation

See the [application plan](docs/application-plan.md) for the complete product workflow, requirements taxonomy, architecture, data model, security boundary, delivery phases, and acceptance criteria.

## Repository data policy

This is a public repository. Do not commit solicitation data, proposal content, customer information, credentials, CUI, ITAR-controlled technical data, export-controlled material, or classified information.
