<!-- markdownlint-disable MD013 -->

# Web Deployment Guide

This guide publishes the PUBLIC-data prototype at the intended address, <https://compliance.insightfuldefense.com>. A deployment is not complete until HTTPS, access control, persistent storage, backup, and a synthetic end-to-end test are all verified.

## Security boundary

The web build remains a **PUBLIC-only prototype**. Do not upload CUI, ITAR-controlled technical data, classified information, source-selection information, proprietary proposal content, credentials, or customer data.

Web mode fails closed unless a shared HTTP Basic username and password are configured, and it protects the UI and API with those credentials. The health endpoint is the only built-in authentication exemption. This is suitable for a controlled PUBLIC-data demonstration, but it does not provide individual accounts, single sign-on, role-based authorization, tenant isolation, or identity-bound review records.

A link from an authenticated main site does not transfer that site's login to the target application. At minimum, distribute the built-in Basic credential only to authorized users. For use beyond a controlled demonstration, protect `compliance.insightfuldefense.com` itself with an organization-managed identity-aware proxy, VPN, or equivalent access layer. Configure that control to fail closed and require an authorized identity for every path; allow `/api/health` only as required by health monitoring.

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
- Built-in shared HTTP Basic authentication
- An optional, stronger identity-aware access layer in front of the exact custom domain

A free Render web service is suitable only for a disposable synthetic demonstration. Its filesystem is ephemeral and it cannot attach the persistent disk required to retain uploaded documents, projects, or decisions across restarts and deploys. Select and review the paid instance and disk costs in Render before creating the service.

## Deploy from GitHub with Render

1. Merge the reviewed deployment change into the repository's `main` branch.
2. Open the repository's [reviewed Render Blueprint](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FAzJester%2Fcompliance), or sign in to Render with an administrative account and choose **New > Blueprint**.
3. Connect the `AzJester/compliance` GitHub repository. Limit the GitHub integration to only the repositories it needs.
4. Select the repository `render.yaml` when prompted and review every proposed resource before applying it.
5. Confirm that the service is built from the repository Dockerfile, uses one instance, attaches its disk at the Blueprint mount path, declares `compliance.insightfuldefense.com`, and checks `/api/health`.
6. Enter a nondefault `COMPLIANCE_AUTH_USERNAME` when Render requests the unsynchronized value. The Blueprint generates a unique `COMPLIANCE_AUTH_PASSWORD`; retrieve and store it in the approved password manager, or replace it with an independently generated value of at least 16 characters.
7. Confirm that preview environments are disabled and automatic deployment waits for GitHub checks to pass. A preview must not copy or mount runtime data.
8. Create the service and follow the first build in the Render **Deploys** view.
9. Open the generated `onrender.com` address using synthetic PUBLIC data. Confirm that the browser requires Basic authentication, then verify the user interface, `/api/health`, project creation, upload, requirement extraction, and one review save.

Do not put secrets, access tokens, or credentials in `render.yaml`, the Docker image, build arguments, repository settings, or deploy logs. Store any identity-proxy credentials in the hosting platform's secret store.

## Web-mode configuration

The Render Blueprint supplies the nonsecret settings, asks the administrator for the shared username, and generates the initial password. Web mode will not start with missing or unsafe host, origin, or credential values.

| Setting | Web deployment requirement |
| --- | --- |
| `COMPLIANCE_MODE` | `web`; remote access is never enabled by the local default |
| `COMPLIANCE_HOST` | `0.0.0.0` inside the container |
| `COMPLIANCE_PORT` | Optional explicit listen port; Render's `PORT` is used when this is absent |
| `COMPLIANCE_DATA_DIR` | `/var/data`, the persistent-disk mount |
| `COMPLIANCE_ALLOWED_ORIGINS` | Exact HTTPS browser origin, with no wildcard |
| `COMPLIANCE_TRUSTED_HOSTS` | Exact hostname only, with no scheme, path, port, or wildcard |
| `COMPLIANCE_AUTH_USERNAME` | Nondefault shared Basic-auth username supplied as a secret |
| `COMPLIANCE_AUTH_PASSWORD` | Unique Basic-auth password of at least 16 characters, supplied as a secret |
| `COMPLIANCE_TRUST_PROXY_HEADERS` | `true` only behind the declared trusted TLS-terminating proxy |
| `COMPLIANCE_TRUSTED_PROXY_CIDRS` | Required non-global proxy networks when trusting proxy headers outside Render |

The Blueprint explicitly permits `https://compliance.insightfuldefense.com` and trusts only the hostname `compliance.insightfuldefense.com`. On Render, the application also adds the platform's exact `RENDER_EXTERNAL_URL` and `RENDER_EXTERNAL_HOSTNAME`, so the generated address remains available during domain setup. Do not replace any value with `*`. Render terminates TLS and supplies `X-Forwarded-Proto`, so the Blueprint enables trusted proxy scheme handling. The application does not trust proxy-supplied client addresses.

If deploying under a different custom domain, change both Blueprint values before deployment: provide the exact HTTPS `COMPLIANCE_ALLOWED_ORIGINS` value and the corresponding hostname-only `COMPLIANCE_TRUSTED_HOSTS` value. TLS must terminate at the application or a proxy you control. Unsafe browser requests are rejected unless their `Origin` matches a configured HTTPS origin.

The Blueprint also lowers the exposed-service intake limits to 10 files, 20 MiB per file, 50 MiB per request, 250 archive entries, 100 MiB expanded archive content, three archive levels, and a compression ratio of 100. Keep these limits unless a measured PUBLIC-data requirement and capacity test justify a reviewed change.

## Configure the custom web address

1. In the Render service, open **Settings > Custom Domains** and confirm that the Blueprint added `compliance.insightfuldefense.com`. Add it manually only if it is absent.
2. At the DNS provider for `insightfuldefense.com`, add the exact CNAME target Render displays for the service. Remove conflicting records for the `compliance` host.
3. Return to Render and verify the custom domain. Wait for Render to issue its managed TLS certificate.
4. Confirm that the service's `/api/health` check remains healthy with the custom-domain Host header.
5. Confirm that HTTP redirects to HTTPS, that <https://compliance.insightfuldefense.com/api/health> returns a successful response, and that every other UI and API path requires the configured Basic credential.
6. If using an identity-aware gateway, apply its policy to `compliance.insightfuldefense.com` itself. Test an authorized user, a signed-out browser, a wrong Basic password, and the health-monitoring path.
7. Add the link to the existing main site only after the access-control test passes.
8. Disable the default `onrender.com` hostname after the custom domain and health check are verified. Basic authentication protects it before that point; disabling the unused route reduces the exposed surface and prevents bypass of a gateway attached only to the custom hostname.

Render's official [custom-domain guide](https://render.com/docs/custom-domains) describes the provider-specific DNS and verification steps. Use the records shown for this service rather than copying example DNS values.

## Persistent data and backups

The persistent mount must contain both the SQLite database and `projects/blobs` document store. Only files below the disk's configured mount path survive a Render restart or deploy. Never change the application data directory to a path outside that mount.

Render persistent disks are available only on paid services, are attached to one service instance, and prevent horizontal scaling. Review the current [persistent-disk behavior and snapshot policy](https://render.com/docs/disks) before relying on it.

Automatic disk snapshots are a recovery layer, not the only backup plan. Because the application combines SQLite metadata with stored blobs, maintain and test an application-consistent backup of the complete data directory. Quiesce writes before a file-level copy, record the application version, store the copy in approved protected storage, and validate restoration in an isolated service. Do not treat a successful code rollback as a data rollback.

This release does not yet provide an in-application export or restore command. A disposable synthetic demonstration may rely on Render snapshots alone. Before retaining important PUBLIC data or review history, an administrator must test both a complete Render snapshot restoration and an independent maintenance-mode transfer of the entire data directory using Render's documented SSH/SCP workflow. Do not keep the only copy of important source material or review history in this prototype.

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
- [ ] The deployed commit passed backend tests, frontend tests, and the production build.
- [ ] The image runs as a non-root user and has no embedded secrets.
- [ ] The container reports the fixed non-root identity and remains able to write its attached disk after a restart.
- [ ] `/api/health` succeeds through the host's health check and the custom domain.
- [ ] `compliance.insightfuldefense.com` presents a valid HTTPS certificate.
- [ ] A unique Basic password of at least 16 characters is stored outside the repository and shared only with authorized users.
- [ ] An unauthenticated browser cannot reach the application or API, except the intentional `/api/health` exemption.
- [ ] The default `onrender.com` hostname is Basic-protected and is disabled after custom-domain verification.
- [ ] The application uses one instance and the data directory is on the persistent disk.
- [ ] A restart retains a synthetic project, document, requirements, and review history.
- [ ] Upload limits are compatible across the access proxy and application.
- [ ] Logs and monitoring do not capture document bodies, extracted text, or credentials.
- [ ] A full snapshot has been restored, an independent secure transfer has been recovered, and backup, disk-capacity alerting, update, and rollback owners are assigned.
- [ ] The existing main site links to the HTTPS custom address only after these checks pass.

Do not represent a successful checklist as CMMC, NIST SP 800-171, FedRAMP, ITAR, or classified-system authorization. Those determinations apply to the complete organizational and system boundary, not this container alone.
