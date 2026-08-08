<!-- markdownlint-disable MD013 -->

# Backend security boundary

The API binds to `127.0.0.1` by default and rejects non-loopback clients, non-local
`Host` values, and browser origins not present in the exact
`COMPLIANCE_ALLOWED_ORIGINS` allowlist. Production defaults allow only the API's own
served origin; development launchers must add their exact frontend origin and port. The
application does not enable CORS or telemetry.

`Content-Length` is rejected before request parsing when it exceeds
`COMPLIANCE_MAX_REQUEST_BYTES`, and an ASGI receive wrapper enforces the same aggregate
limit for chunked or undeclared-length bodies while FastAPI/Starlette parses multipart
framing. The ingestion pipeline additionally enforces per-file, file-count,
archive-depth, compression-method, compression-ratio, and expanded-byte checks.

Original bytes are stored in content-addressed, write-once-by-the-application blob
paths. These paths are not OS-immutable: a sufficiently privileged local process can
modify or delete them, and integrity is verified when matching content is uploaded
again. Document rows represent every upload and archive occurrence, including
duplicates, so filename and archive provenance are not discarded. Rollbacks never
delete blob paths that another transaction could reference.

The loopback and browser-origin controls prevent remote and DNS-rebinding access; they
do not isolate the service from any local process or account able to connect. Windows
account separation, NTFS ACLs, endpoint controls, and workstation policy remain
deployment responsibilities. Remote deployment is outside the supported boundary.
