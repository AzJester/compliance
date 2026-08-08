from __future__ import annotations

import base64
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.database import create_database
from backend.app.main import create_app

_CUSTOM_HOST = "compliance.insightfuldefense.com"
_CUSTOM_ORIGIN = f"https://{_CUSTOM_HOST}"
_RENDER_HOST = "dod-rfp-compliance.onrender.com"
_RENDER_ORIGIN = f"https://{_RENDER_HOST}"
_USERNAME = "reviewer"
_PASSWORD = "correct-horse-battery-staple"


def _authorization(username: str = _USERNAME, password: str = _PASSWORD) -> str:
    encoded = base64.b64encode(f"{username}:{password}".encode()).decode()
    return f"Basic {encoded}"


def _web_settings(tmp_path: Path, **overrides: object) -> Settings:
    frontend_dir = tmp_path / "frontend"
    frontend_dir.mkdir(parents=True, exist_ok=True)
    (frontend_dir / "index.html").write_text("<h1>Compliance</h1>", encoding="utf-8")
    values: dict[str, object] = {
        "data_dir": tmp_path / "data",
        "frontend_dir": frontend_dir,
        "deployment_mode": "web",
        "host": "0.0.0.0",
        "allowed_origins": (_CUSTOM_ORIGIN, _RENDER_ORIGIN),
        "trusted_hosts": (_CUSTOM_HOST, _RENDER_HOST),
        "trust_proxy_headers": True,
        "managed_proxy": True,
        "auth_username": _USERNAME,
        "auth_password": _PASSWORD,
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


def _web_client(app: FastAPI, host: str = _CUSTOM_HOST) -> TestClient:
    return TestClient(
        app,
        base_url=f"https://{host}",
        client=("198.51.100.20", 50_000),
        headers={"host": host, "x-forwarded-proto": "https"},
    )


def test_web_mode_requires_explicit_secure_configuration(tmp_path: Path) -> None:
    common = {
        "data_dir": tmp_path / "data",
        "deployment_mode": "web",
        "host": "0.0.0.0",
        "allowed_origins": (_CUSTOM_ORIGIN,),
        "trusted_hosts": (_CUSTOM_HOST,),
        "auth_username": _USERNAME,
        "auth_password": _PASSWORD,
    }

    with pytest.raises(ValueError, match="COMPLIANCE_ALLOWED_ORIGINS"):
        Settings(**(common | {"allowed_origins": ()}))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="COMPLIANCE_TRUSTED_HOSTS"):
        Settings(**(common | {"trusted_hosts": ()}))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="at least 16"):
        Settings(**(common | {"auth_password": "too-short"}))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="exact HTTPS"):
        Settings(**(common | {"allowed_origins": (f"http://{_CUSTOM_HOST}",)}))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="exact HTTPS"):
        Settings(**(common | {"allowed_origins": (f"https://{_CUSTOM_HOST}:99999",)}))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="non-loopback"):
        Settings(**(common | {"host": "127.0.0.1"}))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="Trusted proxy headers require"):
        Settings(**(common | {"trust_proxy_headers": True}))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="cannot trust the entire internet"):
        Settings(
            **(
                common
                | {
                    "trust_proxy_headers": True,
                    "trusted_proxy_cidrs": ("0.0.0.0/0",),
                }
            )
        )  # type: ignore[arg-type]


def test_local_mode_cannot_expand_its_trusted_host_boundary() -> None:
    with pytest.raises(ValueError, match="loopback-only"):
        Settings(trusted_hosts=("attacker.example",))
    with pytest.raises(ValueError, match="Proxy settings cannot"):
        Settings(managed_proxy=True)
    with pytest.raises(ValueError, match="Proxy settings cannot"):
        Settings(trusted_proxy_cidrs=("127.0.0.1/32",))


def test_render_environment_augments_custom_domain_and_uses_web_limits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("COMPLIANCE_MODE", "web")
    monkeypatch.setenv("COMPLIANCE_HOST", "0.0.0.0")
    monkeypatch.setenv("COMPLIANCE_ALLOWED_ORIGINS", _CUSTOM_ORIGIN)
    monkeypatch.setenv("COMPLIANCE_TRUSTED_HOSTS", _CUSTOM_HOST)
    monkeypatch.setenv("COMPLIANCE_TRUST_PROXY_HEADERS", "true")
    monkeypatch.setenv("COMPLIANCE_AUTH_USERNAME", _USERNAME)
    monkeypatch.setenv("COMPLIANCE_AUTH_PASSWORD", _PASSWORD)
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("RENDER_EXTERNAL_URL", _RENDER_ORIGIN)
    monkeypatch.setenv("RENDER_EXTERNAL_HOSTNAME", _RENDER_HOST)
    monkeypatch.setenv("PORT", "10000")
    monkeypatch.delenv("COMPLIANCE_PORT", raising=False)

    settings = Settings.from_env()

    assert settings.allowed_origins == (_CUSTOM_ORIGIN, _RENDER_ORIGIN)
    assert settings.trusted_hosts == (_CUSTOM_HOST, _RENDER_HOST)
    assert settings.port == 10_000
    assert settings.max_upload_files == 10
    assert settings.max_file_bytes == 20 * 1024 * 1024
    assert settings.max_request_bytes == 50 * 1024 * 1024
    assert settings.max_archive_entries == 250
    assert settings.max_archive_uncompressed_bytes == 100 * 1024 * 1024
    assert settings.max_archive_depth == 3
    assert settings.max_compression_ratio == 100
    assert settings.managed_proxy is True
    assert _PASSWORD not in repr(settings)


def test_web_ui_and_api_require_basic_auth_but_health_is_available(tmp_path: Path) -> None:
    app = create_app(_web_settings(tmp_path))

    with _web_client(app) as client:
        health = client.get("/api/health", headers={"host": _CUSTOM_HOST})
        denied = client.get("/api/projects")
        wrong = client.get(
            "/api/projects", headers={"authorization": _authorization(password="wrong-password")}
        )
        allowed = client.get("/api/projects", headers={"authorization": _authorization()})
        frontend = client.get("/", headers={"authorization": _authorization()})

    assert health.status_code == 200
    assert denied.status_code == 401
    assert denied.headers["www-authenticate"].startswith("Basic ")
    assert denied.headers["cache-control"] == "no-store"
    assert wrong.status_code == 401
    assert allowed.status_code == 200
    assert frontend.status_code == 200
    assert "Compliance" in frontend.text
    assert allowed.headers["cache-control"] == "no-store"
    assert allowed.headers["strict-transport-security"].startswith("max-age=")
    assert allowed.headers["content-security-policy"].startswith("default-src 'self'")
    assert allowed.headers["x-content-type-options"] == "nosniff"

    with _web_client(app) as client:
        direct_health = client.get(
            "/api/health", headers={"host": _CUSTOM_HOST, "x-forwarded-proto": "http"}
        )
        hostile_health = client.get("/api/health", headers={"host": "attacker.example"})
    assert direct_health.status_code == 200
    assert hostile_health.status_code == 400


def test_custom_and_render_hosts_are_both_accepted(tmp_path: Path) -> None:
    app = create_app(_web_settings(tmp_path))

    for host in (_CUSTOM_HOST, _RENDER_HOST):
        with _web_client(app, host) as client:
            health = client.get("/api/health", headers={"host": host})
            projects = client.get("/api/projects", headers={"authorization": _authorization()})
        assert health.status_code == 200
        assert projects.status_code == 200


def test_web_mutations_require_exact_origin(tmp_path: Path) -> None:
    app = create_app(_web_settings(tmp_path))
    payload = {"name": "Public synthetic RFP", "sensitivity": "PUBLIC"}
    auth = {"authorization": _authorization()}

    with _web_client(app) as client:
        missing = client.post("/api/projects", json=payload, headers=auth)
        hostile = client.post(
            "/api/projects", json=payload, headers=auth | {"origin": "https://attacker.example"}
        )
        allowed = client.post(
            "/api/projects", json=payload, headers=auth | {"origin": _CUSTOM_ORIGIN}
        )

    assert missing.status_code == 403
    assert hostile.status_code == 403
    assert allowed.status_code == 201


def test_web_rejects_untrusted_host_transport_and_proxy(tmp_path: Path) -> None:
    app = create_app(_web_settings(tmp_path))
    auth = {"authorization": _authorization()}

    with _web_client(app) as client:
        bad_host = client.get("/api/projects", headers=auth | {"host": "attacker.example"})
        insecure = client.get("/api/projects", headers=auth | {"x-forwarded-proto": "http"})

    cidr_settings = _web_settings(
        tmp_path / "cidr",
        managed_proxy=False,
        trusted_proxy_cidrs=("192.0.2.0/24",),
    )
    cidr_app = create_app(cidr_settings)
    with _web_client(cidr_app) as client:
        untrusted_proxy = client.get("/api/projects", headers=auth)

    assert bad_host.status_code == 400
    assert insecure.status_code == 400
    assert untrusted_proxy.status_code == 400
    assert untrusted_proxy.json()["detail"] == "Request did not arrive through a trusted proxy."


def test_provider_neutral_web_mode_supports_direct_tls_or_an_exact_proxy_cidr(
    tmp_path: Path,
) -> None:
    direct_app = create_app(
        _web_settings(tmp_path / "direct", trust_proxy_headers=False, managed_proxy=False)
    )
    with _web_client(direct_app) as client:
        direct_tls = client.get("/api/projects", headers={"authorization": _authorization()})

    proxy_app = create_app(
        _web_settings(
            tmp_path / "proxy",
            managed_proxy=False,
            trusted_proxy_cidrs=("192.0.2.0/24",),
        )
    )
    with TestClient(
        proxy_app,
        base_url=_CUSTOM_ORIGIN,
        client=("192.0.2.42", 50_000),
        headers={"host": _CUSTOM_HOST, "x-forwarded-proto": "https"},
    ) as client:
        trusted_proxy = client.get("/api/projects", headers={"authorization": _authorization()})

    assert direct_tls.status_code == 200
    assert trusted_proxy.status_code == 200


def test_failed_authentication_is_rate_limited(tmp_path: Path) -> None:
    app = create_app(_web_settings(tmp_path, auth_attempts_per_minute=2))

    with _web_client(app) as client:
        statuses = [client.get("/api/projects").status_code for _ in range(3)]
        limited = client.get("/api/projects")

    assert statuses == [401, 401, 429]
    assert limited.status_code == 429
    assert int(limited.headers["retry-after"]) >= 1


def test_web_mode_requires_built_frontend_and_writable_data_directory(tmp_path: Path) -> None:
    missing_frontend = _web_settings(tmp_path, frontend_dir=tmp_path / "missing")
    with pytest.raises(RuntimeError, match="requires a built frontend"):
        create_app(missing_frontend)

    data_file = tmp_path / "not-a-directory"
    data_file.write_text("blocked", encoding="utf-8")
    with pytest.raises(RuntimeError, match="COMPLIANCE_DATA_DIR is not writable"):
        create_app(Settings(data_dir=data_file))


def test_sqlite_uses_wal_and_busy_timeout(tmp_path: Path) -> None:
    engine, _ = create_database(tmp_path / "database" / "compliance.sqlite3")
    try:
        with engine.connect() as connection:
            journal_mode = connection.exec_driver_sql("PRAGMA journal_mode").scalar_one()
            busy_timeout = connection.exec_driver_sql("PRAGMA busy_timeout").scalar_one()
        assert journal_mode.casefold() == "wal"
        assert busy_timeout == 5_000
    finally:
        engine.dispose()
