from __future__ import annotations

import asyncio
from collections.abc import Callable

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.types import Message, Scope

from backend.app.config import Settings
from backend.app.security import LocalRequestMiddleware


def _client(app: FastAPI, *, host: str = "127.0.0.1") -> TestClient:
    return TestClient(app, client=("127.0.0.1", 50_000), headers={"host": host})


def _scope(*, client: str = "127.0.0.1") -> Scope:
    return {
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/projects",
        "raw_path": b"/api/projects",
        "query_string": b"",
        "headers": [(b"host", b"127.0.0.1")],
        "client": (client, 50_000),
        "server": ("127.0.0.1", 8000),
    }


def test_remote_client_is_rejected() -> None:
    messages: list[Message] = []

    async def app(scope, receive, send):  # type: ignore[no-untyped-def]
        raise AssertionError("A remote request reached the application")

    async def receive() -> Message:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: Message) -> None:
        messages.append(message)

    middleware = LocalRequestMiddleware(app, Settings())
    asyncio.run(middleware(_scope(client="192.0.2.10"), receive, send))
    assert messages[0]["type"] == "http.response.start"
    assert messages[0]["status"] == 403


def test_non_local_host_and_origin_are_rejected(app_factory: Callable[..., FastAPI]) -> None:
    with _client(app_factory(), host="attacker.example") as client:
        assert client.get("/api/health").status_code == 400

    with _client(app_factory()) as client:
        response = client.get("/api/health", headers={"origin": "https://attacker.example"})
        assert response.status_code == 403
        wrong_port = client.get("/api/health", headers={"origin": "http://localhost:5174"})
        assert wrong_port.status_code == 403
        allowed = client.get("/api/health", headers={"origin": "http://localhost:5173"})
        assert allowed.status_code == 200


def test_declared_oversized_request_is_rejected(app_factory: Callable[..., FastAPI]) -> None:
    with _client(app_factory(max_request_bytes=100)) as client:
        response = client.get("/api/health", headers={"content-length": "101"})
    assert response.status_code == 413


def test_interactive_docs_are_disabled_but_local_schema_remains(
    app_factory: Callable[..., FastAPI],
) -> None:
    with _client(app_factory()) as client:
        assert client.get("/api/docs").status_code == 404
        schema = client.get("/api/openapi.json")
    assert schema.status_code == 200
    assert schema.json()["info"]["title"] == "DoD RFP Compliance API"


def test_streamed_body_without_content_length_is_capped() -> None:
    messages: list[Message] = []
    chunks: list[Message] = [
        {"type": "http.request", "body": b"123456", "more_body": True},
        {"type": "http.request", "body": b"78901", "more_body": False},
    ]

    async def app(scope, receive, send):  # type: ignore[no-untyped-def]
        while True:
            message = await receive()
            if not message.get("more_body", False):
                break

    async def receive() -> Message:
        return chunks.pop(0)

    async def send(message: Message) -> None:
        messages.append(message)

    middleware = LocalRequestMiddleware(app, Settings(max_request_bytes=10))
    asyncio.run(middleware(_scope(), receive, send))
    assert messages[0]["type"] == "http.response.start"
    assert messages[0]["status"] == 413
