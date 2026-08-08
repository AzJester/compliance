from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
_DEPLOYMENT_MODES = frozenset({"local", "web"})
_WEB_ACCESS_MODES = frozenset({"authenticated", "anonymous"})


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ValueError(f"{name} must be an integer") from None
    if value <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return value


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    normalized = raw.strip().casefold()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be true or false")


def _env_list(name: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in os.getenv(name, "").split(",") if item.strip())


def _default_origins(port: int) -> tuple[str, ...]:
    return (
        f"http://127.0.0.1:{port}",
        f"http://localhost:{port}",
        f"http://[::1]:{port}",
    )


def _origin_hostname(origin: str, *, deployment_mode: str) -> str:
    parsed = urlsplit(origin)
    port_is_valid = True
    try:
        port = parsed.port
    except ValueError:
        port = None
        port_is_valid = False
    expected_scheme = "https" if deployment_mode == "web" else "http"
    if (
        parsed.scheme != expected_scheme
        or parsed.hostname is None
        or not port_is_valid
        or (deployment_mode == "local" and port is None)
        or parsed.path
        or parsed.query
        or parsed.fragment
        or parsed.username
        or parsed.password
    ):
        if deployment_mode == "web":
            raise ValueError("Web origins must be exact HTTPS origins without paths or credentials")
        raise ValueError("Local origins must be exact loopback HTTP origins with ports")
    hostname = parsed.hostname.casefold()
    if deployment_mode == "local" and hostname not in _LOOPBACK_HOSTS:
        raise ValueError("Local origins must be exact loopback HTTP origins with ports")
    return hostname


def _validate_trusted_host(host: str) -> str:
    normalized = host.strip().casefold().rstrip(".")
    try:
        return ipaddress.ip_address(normalized).compressed
    except ValueError:
        pass
    if (
        not normalized
        or ":" in normalized
        or "*" in normalized
        or "/" in normalized
        or "\\" in normalized
        or "@" in normalized
    ):
        raise ValueError("Trusted hosts must be exact hostnames without ports or wildcards")
    return normalized


def _validate_bind_host(host: str, deployment_mode: str) -> None:
    normalized = host.casefold()
    if deployment_mode == "local":
        if normalized not in _LOOPBACK_HOSTS:
            raise ValueError("COMPLIANCE_HOST must be a loopback address in local mode")
        return
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        raise ValueError("COMPLIANCE_HOST must be an IP address in web mode") from None
    if address.is_loopback:
        raise ValueError("COMPLIANCE_HOST must bind a non-loopback interface in web mode")


@dataclass(frozen=True, slots=True)
class Settings:
    """Runtime settings; web exposure keeps authentication unless explicitly anonymous."""

    data_dir: Path = field(default_factory=lambda: Path.cwd() / ".data")
    frontend_dir: Path | None = None
    deployment_mode: str = "local"
    host: str = "127.0.0.1"
    port: int = 8000
    max_upload_files: int = 100
    max_file_bytes: int = 100 * 1024 * 1024
    max_request_bytes: int = 500 * 1024 * 1024
    max_archive_entries: int = 2_000
    max_archive_uncompressed_bytes: int = 1024 * 1024 * 1024
    max_archive_depth: int = 5
    max_compression_ratio: int = 200
    max_requirement_candidates_per_document: int = 5_000
    max_cdrl_candidates_per_document: int = 500
    max_requirement_candidates_per_run: int = 20_000
    max_cdrl_candidates_per_run: int = 2_000
    allowed_origins: tuple[str, ...] = ()
    trusted_hosts: tuple[str, ...] = ()
    trust_proxy_headers: bool = False
    trusted_proxy_cidrs: tuple[str, ...] = ()
    managed_proxy: bool = False
    web_access_mode: str = "authenticated"
    auth_username: str | None = None
    auth_password: str | None = field(default=None, repr=False)
    auth_attempts_per_minute: int = 10

    def __post_init__(self) -> None:
        deployment_mode = self.deployment_mode.strip().casefold()
        if deployment_mode not in _DEPLOYMENT_MODES:
            raise ValueError("COMPLIANCE_MODE must be 'local' or 'web'")
        object.__setattr__(self, "deployment_mode", deployment_mode)
        web_access_mode = self.web_access_mode.strip().casefold()
        if web_access_mode not in _WEB_ACCESS_MODES:
            raise ValueError("COMPLIANCE_WEB_ACCESS_MODE must be 'authenticated' or 'anonymous'")
        object.__setattr__(self, "web_access_mode", web_access_mode)
        object.__setattr__(self, "data_dir", self.data_dir.resolve())
        if self.frontend_dir is not None:
            object.__setattr__(self, "frontend_dir", self.frontend_dir.resolve())

        _validate_bind_host(self.host, deployment_mode)
        if not self.allowed_origins:
            if deployment_mode == "web":
                raise ValueError("COMPLIANCE_ALLOWED_ORIGINS is required in web mode")
            object.__setattr__(self, "allowed_origins", _default_origins(self.port))

        origin_hosts = {
            _origin_hostname(origin, deployment_mode=deployment_mode)
            for origin in self.allowed_origins
        }
        if not self.trusted_hosts:
            if deployment_mode == "web":
                raise ValueError("COMPLIANCE_TRUSTED_HOSTS is required in web mode")
            object.__setattr__(self, "trusted_hosts", tuple(sorted(_LOOPBACK_HOSTS)))
        normalized_hosts = tuple(_validate_trusted_host(host) for host in self.trusted_hosts)
        object.__setattr__(self, "trusted_hosts", normalized_hosts)
        if deployment_mode == "local" and not set(normalized_hosts).issubset(_LOOPBACK_HOSTS):
            raise ValueError("Trusted hosts must remain loopback-only in local mode")
        if deployment_mode == "web" and not origin_hosts.issubset(set(normalized_hosts)):
            raise ValueError(
                "Every web origin hostname must be present in COMPLIANCE_TRUSTED_HOSTS"
            )

        normalized_proxy_cidrs: list[str] = []
        for network_value in self.trusted_proxy_cidrs:
            try:
                network = ipaddress.ip_network(network_value, strict=False)
            except ValueError:
                raise ValueError(
                    "COMPLIANCE_TRUSTED_PROXY_CIDRS must contain valid IP networks"
                ) from None
            if network.prefixlen == 0:
                raise ValueError("COMPLIANCE_TRUSTED_PROXY_CIDRS cannot trust the entire internet")
            normalized_proxy_cidrs.append(str(network))
        object.__setattr__(self, "trusted_proxy_cidrs", tuple(normalized_proxy_cidrs))

        if deployment_mode == "local":
            if web_access_mode != "authenticated":
                raise ValueError("COMPLIANCE_WEB_ACCESS_MODE can only select anonymous in web mode")
            if self.auth_username is not None or self.auth_password is not None:
                raise ValueError("Web authentication credentials are not used in local mode")
            if self.trust_proxy_headers or self.managed_proxy or self.trusted_proxy_cidrs:
                raise ValueError("Proxy settings cannot be used in local mode")
        elif web_access_mode == "authenticated":
            username = self.auth_username or ""
            password = self.auth_password or ""
            if (
                not username
                or ":" in username
                or any(ord(char) < 32 or ord(char) == 127 for char in username)
            ):
                raise ValueError(
                    "COMPLIANCE_AUTH_USERNAME is required and cannot contain ':' or controls"
                )
            if len(password) < 16 or any(ord(char) < 32 or ord(char) == 127 for char in password):
                raise ValueError(
                    "COMPLIANCE_AUTH_PASSWORD must contain at least 16 characters and no controls"
                )
        if (
            deployment_mode == "web"
            and self.trust_proxy_headers
            and not (self.managed_proxy or self.trusted_proxy_cidrs)
        ):
            raise ValueError(
                "Trusted proxy headers require Render's managed ingress or "
                "COMPLIANCE_TRUSTED_PROXY_CIDRS"
            )

        for field_name in (
            "port",
            "max_upload_files",
            "max_file_bytes",
            "max_request_bytes",
            "max_archive_entries",
            "max_archive_uncompressed_bytes",
            "max_archive_depth",
            "max_compression_ratio",
            "max_requirement_candidates_per_document",
            "max_cdrl_candidates_per_document",
            "max_requirement_candidates_per_run",
            "max_cdrl_candidates_per_run",
            "auth_attempts_per_minute",
        ):
            if getattr(self, field_name) <= 0:
                raise ValueError(f"{field_name} must be greater than zero")
        if self.port > 65_535:
            raise ValueError("COMPLIANCE_PORT must be at most 65535")

    @property
    def web_enabled(self) -> bool:
        return self.deployment_mode == "web"

    @property
    def web_authentication_enabled(self) -> bool:
        return self.web_enabled and self.web_access_mode == "authenticated"

    @property
    def database_path(self) -> Path:
        return self.data_dir / "compliance.sqlite3"

    @property
    def documents_dir(self) -> Path:
        return self.data_dir / "projects"

    @classmethod
    def from_env(cls) -> Settings:
        deployment_mode = os.getenv("COMPLIANCE_MODE", "local").strip().casefold()
        web_enabled = deployment_mode == "web"
        render_origin = os.getenv("RENDER_EXTERNAL_URL", "").strip() if web_enabled else ""
        render_hostname = os.getenv("RENDER_EXTERNAL_HOSTNAME", "").strip() if web_enabled else ""
        allowed_origins = tuple(
            dict.fromkeys((*_env_list("COMPLIANCE_ALLOWED_ORIGINS"), render_origin))
        )
        trusted_hosts = tuple(
            dict.fromkeys((*_env_list("COMPLIANCE_TRUSTED_HOSTS"), render_hostname))
        )
        allowed_origins = tuple(value for value in allowed_origins if value)
        trusted_hosts = tuple(value for value in trusted_hosts if value)

        default_port = _env_int("PORT", 8000) if web_enabled else 8000
        default_file_bytes = 20 * 1024 * 1024 if web_enabled else 100 * 1024 * 1024
        default_request_bytes = 50 * 1024 * 1024 if web_enabled else 500 * 1024 * 1024
        default_archive_bytes = 100 * 1024 * 1024 if web_enabled else 1024 * 1024 * 1024
        frontend_dir_raw = os.getenv("COMPLIANCE_FRONTEND_DIR")
        return cls(
            data_dir=Path(os.getenv("COMPLIANCE_DATA_DIR", Path.cwd() / ".data")),
            frontend_dir=Path(frontend_dir_raw) if frontend_dir_raw else None,
            deployment_mode=deployment_mode,
            host=os.getenv("COMPLIANCE_HOST", "0.0.0.0" if web_enabled else "127.0.0.1"),
            port=_env_int("COMPLIANCE_PORT", default_port),
            max_upload_files=_env_int("COMPLIANCE_MAX_UPLOAD_FILES", 10 if web_enabled else 100),
            max_file_bytes=_env_int("COMPLIANCE_MAX_FILE_BYTES", default_file_bytes),
            max_request_bytes=_env_int("COMPLIANCE_MAX_REQUEST_BYTES", default_request_bytes),
            max_archive_entries=_env_int(
                "COMPLIANCE_MAX_ARCHIVE_ENTRIES", 250 if web_enabled else 2_000
            ),
            max_archive_uncompressed_bytes=_env_int(
                "COMPLIANCE_MAX_ARCHIVE_UNCOMPRESSED_BYTES", default_archive_bytes
            ),
            max_archive_depth=_env_int("COMPLIANCE_MAX_ARCHIVE_DEPTH", 3 if web_enabled else 5),
            max_compression_ratio=_env_int(
                "COMPLIANCE_MAX_COMPRESSION_RATIO", 100 if web_enabled else 200
            ),
            max_requirement_candidates_per_document=_env_int(
                "COMPLIANCE_MAX_REQUIREMENT_CANDIDATES_PER_DOCUMENT", 5_000
            ),
            max_cdrl_candidates_per_document=_env_int(
                "COMPLIANCE_MAX_CDRL_CANDIDATES_PER_DOCUMENT", 500
            ),
            max_requirement_candidates_per_run=_env_int(
                "COMPLIANCE_MAX_REQUIREMENT_CANDIDATES_PER_RUN", 20_000
            ),
            max_cdrl_candidates_per_run=_env_int("COMPLIANCE_MAX_CDRL_CANDIDATES_PER_RUN", 2_000),
            allowed_origins=allowed_origins,
            trusted_hosts=trusted_hosts,
            trust_proxy_headers=_env_bool("COMPLIANCE_TRUST_PROXY_HEADERS"),
            trusted_proxy_cidrs=_env_list("COMPLIANCE_TRUSTED_PROXY_CIDRS"),
            managed_proxy=_env_bool("RENDER") if web_enabled else False,
            web_access_mode=os.getenv("COMPLIANCE_WEB_ACCESS_MODE", "authenticated"),
            auth_username=os.getenv("COMPLIANCE_AUTH_USERNAME"),
            auth_password=os.getenv("COMPLIANCE_AUTH_PASSWORD"),
            auth_attempts_per_minute=_env_int("COMPLIANCE_AUTH_ATTEMPTS_PER_MINUTE", 10),
        )
