# DoD RFP Compliance

<!-- markdownlint-disable MD013 -->

DoD RFP Compliance is a standalone, local-first application for turning Department of Defense solicitation packages into a traceable requirements inventory. A later phase will compare those validated requirements with a proposal response.

The product is intended to help proposal, contracts, and compliance teams find omissions, conflicts, and submission risks while preserving a human approval step for every final compliance determination.

## Current implementation

The first working vertical slice now includes:

- A loopback-default FastAPI service with an explicit, fail-closed authenticated web mode and SQLite project persistence.
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

The current milestone establishes local and authenticated web intake plus a human-reviewed requirements-register prototype. It is not approved for real CUI or ITAR-controlled data. OCR, amendment precedence, incorporated-reference reconciliation, proposal crosswalking, compliance findings, exports, individual identity, and production authorization remain subsequent phases.

See the [user guide](docs/user-guide.md) for the complete review workflow, the [development guide](docs/development.md) to run the application locally, the [web deployment guide](docs/deployment.md) for the PUBLIC-only hosted architecture, and the [requirements-register guide](docs/requirements-register.md) for the extraction rules and limitations.

## Use the application

For a local workstation, run `.\scripts\dev.ps1` from PowerShell and open <http://127.0.0.1:5173>. For the hosted build, open <https://compliance.insightfuldefense.com> only after its administrator confirms the deployment checklist and provides the shared Basic-auth credential.

[Start the reviewed Render Blueprint from GitHub](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FAzJester%2Fcompliance) to provision the hosted build. Render shows the paid service and disk for approval before creating them. Merging this repository alone does not make the custom URL live; the Render deployment, DNS record, domain verification, and TLS certificate must also be completed.

Create one project per solicitation, upload the searchable PDF/DOCX/XLSX/PPTX/ZIP package, verify every document in the manifest, and then select **Extract requirements**. Work through **All Requirements**, **Section L**, **Section M**, and **CDRLs**; compare every candidate with its immutable exact-source excerpt before validating or dismissing it.

## Planned capabilities

- Ingest searchable and scanned PDFs, Word documents, Excel workbooks, PowerPoint files, and nested ZIP packages.
- Identify solicitation Sections A–M, attachments, exhibits, amendments, and incorporated references.
- Build dedicated registers for Section L instructions, Section M evaluation factors, CDRLs, clauses, deliverables, schedules, staffing, security, and data rights.
- Crosswalk each validated requirement to cited evidence in one or more proposal volumes.
- Report compliant, partial, missing, conflicting, not-applicable, and human-review findings.
- Export a compliance workbook, review report, and machine-readable project archive.

## Standalone and web security model

The default release mode is a single-user local web application bound to the workstation loopback interface. Document extraction and search run in the application process; the application sends no document content or telemetry to an AI or external reference service.

An explicit web mode packages the frontend and API in one container and requires exact HTTPS origin and host settings plus a shared HTTP Basic credential. The intended address is <https://compliance.insightfuldefense.com>. The hosted mode is still PUBLIC-only and does not provide individual identities, roles, tenant isolation, or authorization for controlled information. See the [web deployment guide](docs/deployment.md) before enabling it.

This architecture may support a CUI/ITAR-controlled environment, but installing the application does not itself make a workstation or organization compliant with NIST SP 800-171, CMMC, export-control rules, or contractual security obligations. The full system boundary, configuration, policies, and operating environment must be assessed and authorized by the responsible organization.

Classified information is outside the scope of the first release.

## Documentation

- [User guide](docs/user-guide.md): create a project, upload and verify documents, extract requirements, and review the L, M, and CDRL registers.
- [Development guide](docs/development.md): install dependencies, launch the local workstation build, and run validation.
- [Web deployment guide](docs/deployment.md): publish the PUBLIC-only prototype with persistent storage, HTTPS, shared authentication, and an optional identity-aware gateway.
- [Requirements-register guide](docs/requirements-register.md): taxonomy, provenance, extraction, CDRL fields, and review history.
- [Application plan](docs/application-plan.md): product workflow, architecture, data model, security boundary, delivery phases, and acceptance criteria.

## Repository data policy

This is a public repository. Do not commit solicitation data, proposal content, customer information, credentials, CUI, ITAR-controlled technical data, export-controlled material, or classified information.
