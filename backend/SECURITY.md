<!-- markdownlint-disable MD013 -->

# Backend security boundary

## Local and web modes

Local mode remains the default. The API binds to `127.0.0.1`, accepts loopback clients and loopback Host values only, permits only exact configured HTTP loopback origins, and refuses anonymous web access, web credentials, or trusted-proxy settings. This boundary does not isolate the service from another process or account on the workstation; OS account separation, ACLs, endpoint controls, and workstation policy remain deployment responsibilities.

Remote access requires the explicit `COMPLIANCE_MODE=web` configuration. Web mode fails closed unless all of the following are valid:

- A non-loopback IP bind address
- Exact HTTPS `COMPLIANCE_ALLOWED_ORIGINS` values, with no wildcard
- Matching hostname-only `COMPLIANCE_TRUSTED_HOSTS` values, with no wildcard
- An explicit `COMPLIANCE_WEB_ACCESS_MODE` policy: `authenticated` (the default) with a shared `COMPLIANCE_AUTH_USERNAME` and password of at least 16 characters, or the deliberately open `anonymous` mode
- Direct TLS, or trusted TLS-proxy scheme handling constrained to Render managed ingress or explicit non-global `COMPLIANCE_TRUSTED_PROXY_CIDRS`
- A built frontend and writable persistent data directory

Web access defaults to `authenticated`. In that mode, the UI and API require HTTP Basic authentication; only `GET` or `HEAD` on `/api/health` is exempt so hosting health checks can run, and failed authentication is rate-limited in memory. Shared Basic authentication still does not provide individual identities, roles, single sign-on, tenant isolation, or nonrepudiation.

The Render Blueprint deliberately selects `COMPLIANCE_WEB_ACCESS_MODE=anonymous` and declares no application credentials. In anonymous mode, the middleware does not issue an authentication challenge and any supplied Basic credentials are ignored. Every visitor who can reach the service can use all otherwise available UI and API operations, including creating and listing projects, reading project metadata, document manifests, extracted requirements and review history, uploading documents, running extraction, and changing review records. There is no user ownership, privacy, authorization, accountability, or tenant boundary. Request and archive limits constrain a single intake operation but cannot prevent repeated requests, storage exhaustion, service disruption, unexpected hosting cost, malicious content submissions, or one visitor viewing or changing another visitor's records. `X-Robots-Tag: noindex, nofollow` discourages indexing but is not access control. The public URL is not a secret.

Web responses include a restrictive Content Security Policy, HSTS, clickjacking protection, MIME-sniffing protection, no-referrer policy, search-indexing exclusion, and disabled camera, microphone, and geolocation permissions. Web API responses use `Cache-Control: no-store`. Unsafe browser methods require an exact allowed `Origin` regardless of the access mode. Uvicorn proxy-based client rewriting remains disabled; only the application middleware interprets the forwarded HTTPS scheme after establishing the configured trusted-proxy invariant.

The Render Blueprint permits `https://compliance.insightfuldefense.com` and its exact hostname, and the runtime augments those values with Render's exact external URL and hostname. Anonymous mode does not disable exact Host validation, exact browser Origin validation, HTTPS enforcement, security headers, intake limits, or the PUBLIC-sensitivity restriction. These controls reduce specific web and ingestion risks; they do not identify or authorize a visitor. Render terminates TLS, the container runs with a fixed numeric non-root identity, and all persistent state is mounted at `/var/data`. The SQLite database uses WAL mode and a five-second busy timeout, but the service must remain a single instance with one attached disk. The health route performs a lightweight SQLite query without returning project data.

## Data and ingestion boundary

Project creation accepts `PUBLIC` sensitivity only. The API rejects `CUI` and `ITAR` labels even when a caller bypasses the interface. This prototype is not authorized for CUI, ITAR-controlled, classified, source-selection, customer, or proprietary proposal information.

`Content-Length` is rejected before request parsing when it exceeds `COMPLIANCE_MAX_REQUEST_BYTES`, and an ASGI receive wrapper enforces the same aggregate limit for chunked or undeclared-length bodies. The ingestion pipeline also enforces file-count, per-file, archive-entry, expanded-size, depth, compression-method, and compression-ratio limits. The Render Blueprint reduces these limits to 10 files, 20 MiB per file, 50 MiB per request, 250 archive entries, 100 MiB expanded content, three archive levels, and a compression ratio of 100.

Requirement extraction enforces configurable per-document and per-run requirement and CDRL candidate limits. A limit failure returns `413`, rolls back the transaction, and does not leave reviewers with a partial register.

Original bytes are stored in content-addressed, write-once-by-the-application blob paths. Those paths are not OS-immutable: a sufficiently privileged process can modify or delete them, and integrity is rechecked when matching content is uploaded again. Document rows preserve every direct and archive occurrence, including duplicates. Rollbacks never delete a blob that another transaction might reference.

Requirement extraction is a deterministic local process within the running workstation or container. It does not load a remote model, dereference document links, call an external reference service, or transmit source content to an AI service. Exact excerpts are untrusted text and are returned as JSON for escaped text rendering.

Review decisions preserve before-and-after values, a reviewer label, timestamp, and note. The label is entered by the reviewer and is not bound to an authenticated or externally verified identity. In the anonymous deployment, any visitor can enter any reviewer label. Administrators and processes with direct database or disk access remain inside the trusted deployment boundary.

Persistent deployments must back up the SQLite database and content-addressed store as one unit, protect that backup like the source data, and test restoration. A successful application deployment or code rollback is not a data backup.
