<!-- markdownlint-disable MD013 -->

# Web Deployment Guide

This guide publishes the anonymous PUBLIC/synthetic-data prototype at the intended address, <https://compliance.insightfuldefense.com>. A deployment is not complete until HTTPS, the explicit anonymous access policy, persistent storage, backup, and a synthetic end-to-end test are all verified.

## Security boundary

The web build remains a **PUBLIC/synthetic-only prototype**. Upload only synthetic material or independently confirmed PUBLIC sources. Do not upload non-public solicitation material, proposal content, CUI, ITAR-controlled technical data, classified information, source-selection information, proprietary content, credentials, or customer data.

Web access defaults to shared HTTP Basic authentication, but this repository's Render Blueprint deliberately sets `COMPLIANCE_WEB_ACCESS_MODE=anonymous`. The deployed UI and API do not ask for or validate a username or password. Anyone on the internet who can reach either public hostname can use all otherwise available operations: create and list projects, read project metadata, document manifests, extracted requirements, crosswalk findings, and optional review history, submit uploads, run extraction and proposal assessment, and change review records. There is no privacy, user identity, ownership, authorization, tenant isolation, or identity-bound audit record.

Anonymous access also permits repeated requests, storage exhaustion, service disruption, malicious or misleading submissions, changes by unrelated visitors, and unexpected hosting cost. File, archive, and request limits reduce the impact of one operation but do not prevent abuse. Exact Host and browser Origin checks, HTTPS, security headers, and `noindex` responses remain enabled, but none of them identifies or authorizes a visitor. An Origin check is not a defense against a scripted client, and the public URL is not a secret.

Do not rely on a login at `insightfuldefense.com` to protect this application; a link does not transfer the main site's access policy. Adding an identity-aware proxy or VPN later would change the current anonymous-access decision and requires a separate deployment review.

Keep the service at one instance. The current persistence layer is SQLite plus a local content-addressed document store; it is not designed for horizontal replicas or a shared network filesystem.

## Why this cannot use GitHub Pages or GitHub Actions

[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) publishes static site files. It cannot run the Python/FastAPI API, accept and extract uploaded documents, or persist the SQLite database and document store. [GitHub-hosted Actions jobs have execution limits](https://docs.github.com/en/actions/reference/limits), so Actions is a build and validation runner rather than an always-on application host. Use Actions to test the repository and a stateful web-service host to run the application.

## Recommended Render architecture

The repository's Render Blueprint defines one Docker web service. The production image builds the React frontend and serves it from the FastAPI process on the same origin. The service uses:

- A paid Render `starter` web-service instance
- One 10 GB persistent disk mounted at `/var/data`
- One service instance
- An HTTP health check at `/api/health` that verifies SQLite connectivity
- Render-managed HTTPS for the custom domain
- Explicit anonymous application access with no username or password
- Exact HTTPS origin and Host settings retained as request-integrity safeguards, not visitor access controls

A free Render web service is suitable only for a disposable synthetic demonstration. Its filesystem is ephemeral and it cannot attach the persistent disk required to retain uploaded documents, projects, or decisions across restarts and deploys. Select and review the paid instance and disk costs in Render before creating the service.

## Deploy from GitHub with Render

1. Merge the reviewed deployment change into the repository's `main` branch.
2. Open the repository's [reviewed Render Blueprint](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FAzJester%2Fcompliance), or sign in to Render with an administrative account and choose **New > Blueprint**.
3. Connect the `AzJester/compliance` GitHub repository. Limit the GitHub integration to only the repositories it needs.
4. Select the repository `render.yaml` when prompted and review every proposed resource before applying it.
5. Confirm that the service is built from the repository Dockerfile, uses one instance, attaches its disk at the Blueprint mount path, declares `compliance.insightfuldefense.com`, and checks `/api/health`.
6. Before changing an existing service, inventory its attached data while the old protection is still active. Anonymous mode makes every retained project, manifest, requirement, excerpt, and review record public and editable immediately. Do not continue unless the disk is empty or contains only material intentionally approved for anonymous publication; use a separate disk or an approved backup-and-reset procedure when provenance is uncertain.
7. Confirm that `COMPLIANCE_WEB_ACCESS_MODE` is exactly `anonymous` and that the Blueprint does not request or generate `COMPLIANCE_AUTH_USERNAME` or `COMPLIANCE_AUTH_PASSWORD`.
8. Confirm that preview environments are disabled and automatic deployment waits for GitHub checks to pass. A preview must not copy or mount runtime data.
9. Create or update the service and follow the first build in the Render **Deploys** view.
10. Open the generated `onrender.com` address in a signed-out or fresh browser without an `Authorization` header. Confirm that the root page returns `200` without a sign-in prompt, then use only synthetic PUBLIC data to verify the user interface, `/api/health`, project creation, project listing and reading, solicitation upload with automatic requirement extraction, proposal upload with automatic coverage assessment, and one optional manual override.

Do not put secrets, access tokens, or credentials in `render.yaml`, the Docker image, build arguments, repository settings, or deploy logs. Store any identity-proxy credentials in the hosting platform's secret store.

## Web-mode configuration

The Render Blueprint supplies the nonsecret settings and explicitly chooses anonymous access. Web mode will not start with missing or unsafe Host, Origin, TLS-proxy, or access-mode values. If `COMPLIANCE_WEB_ACCESS_MODE` is omitted, the safer runtime default is `authenticated`, which will fail closed unless valid credentials are supplied.

| Setting | Web deployment requirement |
| --- | --- |
| `COMPLIANCE_MODE` | `web`; remote access is never enabled by the local default |
| `COMPLIANCE_WEB_ACCESS_MODE` | `anonymous` for this deliberately open deployment; runtime default is `authenticated` |
| `COMPLIANCE_HOST` | `0.0.0.0` inside the container |
| `COMPLIANCE_PORT` | Optional explicit listen port; Render's `PORT` is used when this is absent |
| `COMPLIANCE_DATA_DIR` | `/var/data`, the persistent-disk mount |
| `COMPLIANCE_ALLOWED_ORIGINS` | Exact HTTPS browser origin, with no wildcard |
| `COMPLIANCE_TRUSTED_HOSTS` | Exact hostname only, with no scheme, path, port, or wildcard |
| `COMPLIANCE_AUTH_USERNAME` | Absent in anonymous mode; required only when access mode is `authenticated` |
| `COMPLIANCE_AUTH_PASSWORD` | Absent in anonymous mode; a unique secret of at least 16 characters is required only when access mode is `authenticated` |
| `COMPLIANCE_TRUST_PROXY_HEADERS` | `true` only behind the declared trusted TLS-terminating proxy |
| `COMPLIANCE_TRUSTED_PROXY_CIDRS` | Required non-global proxy networks when trusting proxy headers outside Render |

The Blueprint explicitly permits `https://compliance.insightfuldefense.com` and trusts only the hostname `compliance.insightfuldefense.com`. On Render, the application also adds the platform's exact `RENDER_EXTERNAL_URL` and `RENDER_EXTERNAL_HOSTNAME`, so the generated address remains available during domain setup. Do not replace any value with `*`. Render terminates TLS and supplies `X-Forwarded-Proto`, so the Blueprint enables trusted proxy scheme handling. The application does not trust proxy-supplied client addresses.

In anonymous mode, supplied Basic credentials are ignored. Remove any old `COMPLIANCE_AUTH_USERNAME` and `COMPLIANCE_AUTH_PASSWORD` values left on an existing Render service so unused secrets are not retained. Their presence does not restore access control while `COMPLIANCE_WEB_ACCESS_MODE=anonymous`.

If deploying under a different custom domain, change both Blueprint values before deployment: provide the exact HTTPS `COMPLIANCE_ALLOWED_ORIGINS` value and the corresponding hostname-only `COMPLIANCE_TRUSTED_HOSTS` value. TLS must terminate at the application or a proxy you control. Unsafe browser requests are rejected unless their `Origin` matches a configured HTTPS origin.

The Blueprint also lowers the exposed-service intake limits to 10 files, 20 MiB per file, 50 MiB per request, 250 archive entries, 100 MiB expanded archive content, three archive levels, and a compression ratio of 100. Keep these limits unless a measured PUBLIC-data requirement and capacity test justify a reviewed change.

## Configure the custom web address

1. In the Render service, open **Settings > Custom Domains** and confirm that the Blueprint added `compliance.insightfuldefense.com`. Add it manually only if it is absent.
2. At the DNS provider for `insightfuldefense.com`, add the exact CNAME target Render displays for the service. Remove conflicting records for the `compliance` host.
3. Return to Render and verify the custom domain. Wait for Render to issue its managed TLS certificate.
4. Confirm that the service's `/api/health` check remains healthy with the custom-domain Host header.
5. Confirm that HTTP redirects to HTTPS and that <https://compliance.insightfuldefense.com/api/health> returns a successful response.
6. In a fresh browser with no application credentials, confirm that the root page and data API return `200` without a sign-in prompt. Create, list, and read one synthetic project to verify the intended anonymous behavior.
7. Confirm that an untrusted Host is rejected, a non-HTTPS application request is rejected or redirected by the platform, and an unsafe browser request with a missing or unapproved `Origin` is rejected. These safeguards must remain active in anonymous mode.
8. Add the link to the existing main site only after the owner accepts that every internet visitor can access and change all application data.
9. Disable the default `onrender.com` hostname after the custom domain and health check are verified. Until then, both hostnames are anonymous; disabling the unused route reduces the exposed surface.

Render's official [custom-domain guide](https://render.com/docs/custom-domains) describes the provider-specific DNS and verification steps. Use the records shown for this service rather than copying example DNS values.

## Persistent data and backups

The persistent mount must contain both the SQLite database and `projects/blobs` document store. Only files below the disk's configured mount path survive a Render restart or deploy. Never change the application data directory to a path outside that mount.

Render persistent disks are available only on paid services, are attached to one service instance, and prevent horizontal scaling. Review the current [persistent-disk behavior and snapshot policy](https://render.com/docs/disks) before relying on it.

Automatic disk snapshots are a recovery layer, not the only backup plan. Because the application combines SQLite metadata with stored blobs, maintain and test an application-consistent backup of the complete data directory. Quiesce writes before a file-level copy, record the application version, store the copy in approved protected storage, and validate restoration in an isolated service. Do not treat a successful code rollback as a data rollback.

The application can export current compliance registers, but those files are not a complete backup and there is no in-application backup or restore command. A disposable synthetic demonstration may rely on Render snapshots alone. Before retaining important PUBLIC data or review history, an administrator must test both a complete Render snapshot restoration and an independent maintenance-mode transfer of the entire data directory using Render's documented SSH/SCP workflow. Do not keep the only copy of important source material or review history in this prototype.

Monitor disk usage and set an operational threshold below capacity. The current release has no retention or project-deletion workflow, and disk size cannot be reduced after expansion.

## Update and rollback

1. Require the repository test workflow and review before merging to `main`.
2. Back up the complete persistent data directory before a release that changes persistence or extraction behavior.
3. Let Render build the merged commit and wait for the health check to pass.
4. Repeat the synthetic smoke test at the custom domain.
5. If code fails, roll back to the last known-good image or commit. Do not overwrite or restore the data disk as part of a routine code rollback.
6. If data recovery is necessary, stop writes and follow the tested backup-restoration procedure; preserve the current volume until recovery is verified.

## Deployment acceptance checklist

- [ ] Only PUBLIC, synthetic test data was used.
- [ ] Before anonymous cutover, the attached disk was verified empty or limited to records intentionally approved for anonymous publication.
- [ ] The deployed commit passed backend tests, frontend tests, and the production build.
- [ ] The image runs as a non-root user and has no embedded secrets.
- [ ] The container reports the fixed non-root identity and remains able to write its attached disk after a restart.
- [ ] `/api/health` succeeds through the host's health check and the custom domain.
- [ ] `compliance.insightfuldefense.com` presents a valid HTTPS certificate.
- [ ] `COMPLIANCE_WEB_ACCESS_MODE=anonymous` is explicit, and no application username or password is declared in the Blueprint.
- [ ] The root page and data API return `200` without an `Authorization` header or sign-in prompt; a synthetic project can be created, listed, and read anonymously.
- [ ] Exact Host, HTTPS, and unsafe-request Origin checks remain active even though they are not visitor access controls.
- [ ] The owner accepts that anyone can read and change all application records and can attempt abuse or resource exhaustion.
- [ ] The default `onrender.com` hostname is disabled after custom-domain verification because it is anonymous while enabled.
- [ ] The application uses one instance and the data directory is on the persistent disk.
- [ ] A restart retains a synthetic project, solicitation and proposal documents, requirements, crosswalk findings, and any optional review history.
- [ ] Upload limits are compatible across the access proxy and application.
- [ ] Logs and monitoring do not capture document bodies or extracted text.
- [ ] A full snapshot has been restored, an independent secure transfer has been recovered, and backup, disk-capacity alerting, abuse response, reset, update, and rollback owners are assigned.
- [ ] The existing main site links to the HTTPS custom address only after these checks pass.

Do not represent a successful checklist as CMMC, NIST SP 800-171, FedRAMP, ITAR, or classified-system authorization. Those determinations apply to the complete organizational and system boundary, not this container alone.
