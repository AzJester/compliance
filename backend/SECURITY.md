<!-- markdownlint-disable MD013 -->

# Backend security boundary

## Local and web modes

Local mode remains the default. The API binds to `127.0.0.1`, accepts loopback clients and loopback Host values only, permits only exact configured HTTP loopback origins, and refuses web credentials or trusted-proxy settings. This boundary does not isolate the service from another process or account on the workstation; OS account separation, ACLs, endpoint controls, and workstation policy remain deployment responsibilities.

Remote access requires the explicit `COMPLIANCE_MODE=web` configuration. Web mode fails closed unless all of the following are valid:

- A non-loopback IP bind address
- Exact HTTPS `COMPLIANCE_ALLOWED_ORIGINS` values, with no wildcard
- Matching hostname-only `COMPLIANCE_TRUSTED_HOSTS` values, with no wildcard
- A shared `COMPLIANCE_AUTH_USERNAME` and password of at least 16 characters
- Direct TLS, or trusted TLS-proxy scheme handling constrained to Render managed ingress or explicit non-global `COMPLIANCE_TRUSTED_PROXY_CIDRS`
- A built frontend and writable persistent data directory

The UI and API require HTTP Basic authentication in web mode. Only `GET` or `HEAD` on `/api/health` is exempt so hosting health checks can run; the route contains no project data. Failed authentication is rate-limited in memory. Shared Basic authentication does not provide individual identities, roles, single sign-on, tenant isolation, or nonrepudiation. An identity-aware proxy or VPN is recommended as defense in depth for use beyond a controlled PUBLIC-data demonstration.

Web responses include a restrictive Content Security Policy, HSTS, clickjacking protection, MIME-sniffing protection, no-referrer policy, search-indexing exclusion, and disabled camera, microphone, and geolocation permissions. Authenticated API responses use `Cache-Control: no-store`. Unsafe browser methods require an exact allowed `Origin`, including when valid Basic credentials are present. Uvicorn proxy-based client rewriting remains disabled; only the application middleware interprets the forwarded HTTPS scheme after establishing the configured trusted-proxy invariant.

The Render Blueprint permits `https://compliance.insightfuldefense.com` and its exact hostname, and the runtime augments those values with Render's exact external URL and hostname. Render terminates TLS, the container runs with a fixed numeric non-root identity, and all persistent state is mounted at `/var/data`. The SQLite database uses WAL mode and a five-second busy timeout, but the service must remain a single instance with one attached disk. The unauthenticated health route performs a lightweight SQLite query without returning project data.

## Data and ingestion boundary

Project creation accepts `PUBLIC` sensitivity only. The API rejects `CUI` and `ITAR` labels even when a caller bypasses the interface. This prototype is not authorized for CUI, ITAR-controlled, classified, source-selection, customer, or proprietary proposal information.

`Content-Length` is rejected before request parsing when it exceeds `COMPLIANCE_MAX_REQUEST_BYTES`, and an ASGI receive wrapper enforces the same aggregate limit for chunked or undeclared-length bodies. The ingestion pipeline also enforces file-count, per-file, archive-entry, expanded-size, depth, compression-method, and compression-ratio limits. The Render Blueprint reduces these limits to 10 files, 20 MiB per file, 50 MiB per request, 250 archive entries, 100 MiB expanded content, three archive levels, and a compression ratio of 100.

Requirement extraction enforces configurable per-document and per-run requirement and CDRL candidate limits. A limit failure returns `413`, rolls back the transaction, and does not leave reviewers with a partial register.

Original bytes are stored in content-addressed, write-once-by-the-application blob paths. Those paths are not OS-immutable: a sufficiently privileged process can modify or delete them, and integrity is rechecked when matching content is uploaded again. Document rows preserve every direct and archive occurrence, including duplicates. Rollbacks never delete a blob that another transaction might reference.

Requirement extraction is a deterministic local process within the running workstation or container. It does not load a remote model, dereference document links, call an external reference service, or transmit source content to an AI service. Exact excerpts are untrusted text and are returned as JSON for escaped text rendering.

Review decisions preserve before-and-after values, a reviewer label, timestamp, and note. The label is entered by the reviewer and is not bound to the Basic username or an external identity. Administrators and processes with direct database or disk access remain inside the trusted deployment boundary.

Persistent deployments must back up the SQLite database and content-addressed store as one unit, protect that backup like the source data, and test restoration. A successful application deployment or code rollback is not a data backup.
