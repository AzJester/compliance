from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = int(raw)
    if value <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return value


def _default_origins(port: int) -> tuple[str, ...]:
    return (
        f"http://127.0.0.1:{port}",
        f"http://localhost:{port}",
        f"http://[::1]:{port}",
    )


def _validate_origin(origin: str) -> None:
    parsed = urlsplit(origin)
    try:
        port = parsed.port
    except ValueError:
        port = None
    if (
        parsed.scheme != "http"
        or parsed.hostname not in _LOOPBACK_HOSTS
        or port is None
        or parsed.path
        or parsed.query
        or parsed.fragment
        or parsed.username
        or parsed.password
    ):
        raise ValueError("Allowed origins must be exact loopback HTTP origins with ports")


@dataclass(frozen=True, slots=True)
class Settings:
    """Runtime settings. All defaults keep the service local to this workstation."""

    data_dir: Path = field(default_factory=lambda: Path.cwd() / ".data")
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

    def __post_init__(self) -> None:
        object.__setattr__(self, "data_dir", self.data_dir.resolve())
        if self.host not in _LOOPBACK_HOSTS:
            raise ValueError("COMPLIANCE_HOST must be a loopback address")
        if not self.allowed_origins:
            object.__setattr__(self, "allowed_origins", _default_origins(self.port))
        for origin in self.allowed_origins:
            _validate_origin(origin)
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
        ):
            if getattr(self, field_name) <= 0:
                raise ValueError(f"{field_name} must be greater than zero")

    @property
    def database_path(self) -> Path:
        return self.data_dir / "compliance.sqlite3"

    @property
    def documents_dir(self) -> Path:
        return self.data_dir / "projects"

    @classmethod
    def from_env(cls) -> Settings:
        allowed_origins = tuple(
            origin.strip()
            for origin in os.getenv("COMPLIANCE_ALLOWED_ORIGINS", "").split(",")
            if origin.strip()
        )
        return cls(
            data_dir=Path(os.getenv("COMPLIANCE_DATA_DIR", Path.cwd() / ".data")),
            host=os.getenv("COMPLIANCE_HOST", "127.0.0.1"),
            port=_env_int("COMPLIANCE_PORT", 8000),
            max_upload_files=_env_int("COMPLIANCE_MAX_UPLOAD_FILES", 100),
            max_file_bytes=_env_int("COMPLIANCE_MAX_FILE_BYTES", 100 * 1024 * 1024),
            max_request_bytes=_env_int("COMPLIANCE_MAX_REQUEST_BYTES", 500 * 1024 * 1024),
            max_archive_entries=_env_int("COMPLIANCE_MAX_ARCHIVE_ENTRIES", 2_000),
            max_archive_uncompressed_bytes=_env_int(
                "COMPLIANCE_MAX_ARCHIVE_UNCOMPRESSED_BYTES", 1024 * 1024 * 1024
            ),
            max_archive_depth=_env_int("COMPLIANCE_MAX_ARCHIVE_DEPTH", 5),
            max_compression_ratio=_env_int("COMPLIANCE_MAX_COMPRESSION_RATIO", 200),
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
        )
