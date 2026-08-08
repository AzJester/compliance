# DoD RFP Compliance

<!-- markdownlint-disable MD013 -->

DoD RFP Compliance is a planned standalone Windows application for turning Department of Defense solicitation packages into a traceable requirements inventory and comparing those requirements with a proposal response.

The product is intended to help proposal, contracts, and compliance teams find omissions, conflicts, and submission risks while preserving a human approval step for every final compliance determination.

## Planned capabilities

- Ingest searchable and scanned PDFs, Word documents, Excel workbooks, PowerPoint files, and nested ZIP packages.
- Identify solicitation Sections A–M, attachments, exhibits, amendments, and incorporated references.
- Build dedicated registers for Section L instructions, Section M evaluation factors, CDRLs, clauses, deliverables, schedules, staffing, security, and data rights.
- Crosswalk each validated requirement to cited evidence in one or more proposal volumes.
- Report compliant, partial, missing, conflicting, not-applicable, and human-review findings.
- Export a compliance workbook, review report, and machine-readable project archive.

## Standalone security model

The first release is planned as a single-user local web application running only on an approved Windows workstation. Document extraction, search, and model inference remain local; the application requires no cloud service and sends no document content or telemetry off the workstation.

This architecture may support a CUI/ITAR-controlled environment, but installing the application does not itself make a workstation or organization compliant with NIST SP 800-171, CMMC, export-control rules, or contractual security obligations. The full system boundary, configuration, policies, and operating environment must be assessed and authorized by the responsible organization.

Classified information is outside the scope of the first release.

## Documentation

See the [application plan](docs/application-plan.md) for the complete product workflow, requirements taxonomy, architecture, data model, security boundary, delivery phases, and acceptance criteria.

## Repository data policy

This is a public repository. Do not commit solicitation data, proposal content, customer information, credentials, CUI, ITAR-controlled technical data, export-controlled material, or classified information.
