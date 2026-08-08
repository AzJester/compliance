from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit

from fastapi.responses import JSONResponse
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import Settings

_LOCAL_HOSTNAMES = frozenset({"localhost", "127.0.0.1", "::1"})


class _RequestTooLarge(Exception):
    pass


def _is_loopback_address(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    if address.is_loopback:
        return True
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        return address.ipv4_mapped.is_loopback
    return False


def _local_host_header(value: str) -> bool:
    if not value or "@" in value or "/" in value or "\\" in value:
        return False
    try:
        parsed = urlsplit(f"//{value}")
        _ = parsed.port
    except ValueError:
        return False
    return parsed.hostname is not None and parsed.hostname.casefold() in _LOCAL_HOSTNAMES


def _request_error(scope: Scope, settings: Settings) -> JSONResponse | None:
    client = scope.get("client")
    client_host = client[0] if client is not None else ""
    if not _is_loopback_address(client_host):
        return JSONResponse(status_code=403, content={"detail": "Only local clients are allowed."})

    headers = Headers(scope=scope)
    if not _local_host_header(headers.get("host", "")):
        return JSONResponse(status_code=400, content={"detail": "Invalid Host header."})

    origin = headers.get("origin")
    allowed_origins = {allowed.casefold() for allowed in settings.allowed_origins}
    if origin is not None and origin.casefold() not in allowed_origins:
        return JSONResponse(
            status_code=403, content={"detail": "Non-local origins are not allowed."}
        )

    content_length = headers.get("content-length")
    if content_length is not None:
        try:
            length = int(content_length)
        except ValueError:
            return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length."})
        if length < 0:
            return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length."})
        if length > settings.max_request_bytes:
            return JSONResponse(status_code=413, content={"detail": "Request body is too large."})
    return None


class LocalRequestMiddleware:
    """Enforce the loopback boundary and cap both declared and streamed body bytes."""

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        error = _request_error(scope, self.settings)
        if error is not None:
            await error(scope, receive, send)
            return

        received_bytes = 0

        async def limited_receive() -> Message:
            nonlocal received_bytes
            message = await receive()
            if message["type"] == "http.request":
                received_bytes += len(message.get("body", b""))
                if received_bytes > self.settings.max_request_bytes:
                    raise _RequestTooLarge
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _RequestTooLarge:
            response = JSONResponse(
                status_code=413, content={"detail": "Request body is too large."}
            )
            await response(scope, receive, send)
