<!-- markdownlint-disable MD013 -->

# Development Guide

This guide covers a local developer setup for the standalone DoD RFP compliance application. The backend and frontend listen only on the workstation loopback interface by default.

## Prerequisites

Install the following tools on Windows:

- Git
- Python 3.12 or newer
- Node.js 22 or newer
- pnpm 10
- PowerShell 7 is recommended; Windows PowerShell 5.1 is also supported by the launcher

The application is designed for an approved Windows workstation. Developer tooling does not itself make a workstation suitable for handling Controlled Unclassified Information (CUI), export-controlled data, or classified material.

## Initial setup

Clone the repository and enter its directory:

```powershell
git clone https://github.com/AzJester/compliance.git
Set-Location compliance
```

Create and activate a Python virtual environment, then install the backend and development dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

Enable pnpm through Corepack if necessary, then install the locked frontend dependencies:

```powershell
corepack enable
Set-Location frontend
pnpm install --frozen-lockfile
Set-Location ..
```

Dependency lockfiles must remain committed. Do not regenerate them unless a dependency change is intentional and reviewed.

## Run the application

From the repository root, start both development servers:

```powershell
.\scripts\dev.ps1
```

The launcher checks the required runtimes and installed dependencies before starting either process. It does not install, delete, or overwrite project files. Both services bind to `127.0.0.1`:

- Frontend: <http://127.0.0.1:5173>
- API: <http://127.0.0.1:8000>
- OpenAPI document: <http://127.0.0.1:8000/api/openapi.json>

Interactive Swagger and ReDoc pages are intentionally disabled because their default assets are served by external CDNs. The raw OpenAPI JSON remains available locally without loading third-party code.

The launcher also limits accepted browser origins to the selected frontend and API loopback ports. When starting the API independently for frontend development, set `COMPLIANCE_ALLOWED_ORIGINS` to the exact trusted loopback origins rather than allowing arbitrary localhost ports.

Use alternate loopback ports when the defaults are occupied:

```powershell
.\scripts\dev.ps1 -ApiPort 8010 -WebPort 5180
```

Press Ctrl+C in the launcher terminal to stop both services.

To run either service independently, use these commands from the repository root:

```powershell
python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

```powershell
Set-Location frontend
pnpm dev --host 127.0.0.1 --port 5173 --strictPort
```

Do not change the host to `0.0.0.0` on a workstation containing sensitive data. Doing so exposes the development server to other network interfaces.

## Local data boundary

Runtime projects, uploads, extracted text, OCR output, databases, logs, and generated exports belong under the repository-local `.data/` directory during development. These artifacts are ignored by Git, but ignore rules are not a security control or a substitute for approved storage and access controls.

This repository is public. Never commit, upload, paste, or attach any of the following to the repository, pull requests, issues, CI logs, test reports, screenshots, or recordings:

- Real solicitations, proposals, CDRLs, amendments, or procurement-source-selection material
- CUI, Federal Contract Information, ITAR/export-controlled technical data, or classified information
- Customer, subcontractor, employee, pricing, credential, or proprietary data
- Secrets, access tokens, private keys, production configuration, or real document extracts

Use small, clearly labeled, fully synthetic fixtures for tests. Do not derive a fixture by merely redacting or renaming a real procurement document. Classified material is outside the application's v1 boundary and must not be ingested.

For any authorized sensitive-data development, use an organization-approved workstation, encrypted storage, endpoint protection, access controls, retention policy, and backup process. Keep data outside cloud-synchronized folders unless the relevant security authority has expressly approved them.

## Validate changes

Run the backend test suite from the repository root:

```powershell
python -m pytest backend/tests
```

Run the frontend tests and production build:

```powershell
Set-Location frontend
pnpm test --run
pnpm build
```

Before opening a pull request, run all three checks and inspect `git status` to ensure that only intended source and synthetic test files are present. GitHub Actions repeats the backend tests on Windows and the frontend tests and build on Ubuntu. The CI workflow has read-only repository permissions and performs no deployment.
