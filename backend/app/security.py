from __future__ import annotations

import base64
import binascii
import ipaddress
import secrets
import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable
from urllib.parse import urlsplit

from fastapi.responses import JSONResponse
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import Settings

_LOCAL_HOSTNAMES = frozenset({"localhost", "127.0.0.1", "::1"})
_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_AUTH_CHALLENGE = 'Basic realm="DoD RFP Compliance", charset="UTF-8"'
_CONTENT_SECURITY_POLICY = (
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; "
    "object-src 'none'; connect-src 'self'; img-src 'self' data:; "
    "style-src 'self'; script-src 'self'"
)


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


def _parse_host_header(value: str) -> str | None:
    if not value or "@" in value or "/" in value or "\\" in value:
        return None
    try:
        parsed = urlsplit(f"//{value}")
        _ = parsed.port
    except ValueError:
        return None
    if parsed.hostname is None:
        return None
    return parsed.hostname.casefold().rstrip(".")


def _valid_basic_credentials(value: str | None, settings: Settings) -> bool:
    if value is None:
        return False
    scheme, separator, encoded = value.partition(" ")
    if not separator or scheme.casefold() != "basic" or not encoded or " " in encoded:
        return False
    try:
        decoded = base64.b64decode(encoded, validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return False
    username, separator, password = decoded.partition(":")
    if not separator:
        return False
    expected_username = settings.auth_username or ""
    expected_password = settings.auth_password or ""
    username_matches = secrets.compare_digest(
        username.encode("utf-8"), expected_username.encode("utf-8")
    )
    password_matches = secrets.compare_digest(
        password.encode("utf-8"), expected_password.encode("utf-8")
    )
    return username_matches and password_matches


class _AuthFailureLimiter:
    """Small in-memory limiter for password guessing; web mode runs as one SQLite instance."""

    def __init__(
        self, attempts_per_minute: int, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.attempts_per_minute = attempts_per_minute
        self.clock = clock
        self._attempts: defaultdict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def record_or_limit(self, client: str) -> int | None:
        now = self.clock()
        cutoff = now - 60
        with self._lock:
            attempts = self._attempts[client]
            while attempts and attempts[0] <= cutoff:
                attempts.popleft()
            if len(attempts) >= self.attempts_per_minute:
                return max(1, int(60 - (now - attempts[0])))
            attempts.append(now)
        return None

    def clear(self, client: str) -> None:
        with self._lock:
            self._attempts.pop(client, None)


def _security_headers(message: Message, *, web_enabled: bool, path: str) -> None:
    if message["type"] != "http.response.start":
        return
    headers = MutableHeaders(scope=message)
    headers.setdefault("Content-Security-Policy", _CONTENT_SECURITY_POLICY)
    headers.setdefault("Referrer-Policy", "no-referrer")
    headers.setdefault("X-Content-Type-Options", "nosniff")
    headers.setdefault("X-Frame-Options", "DENY")
    headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if web_enabled:
        headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        headers.setdefault("X-Robots-Tag", "noindex, nofollow")
        if path.startswith("/api/"):
            headers.setdefault("Cache-Control", "no-store")


class LocalRequestMiddleware:
    """Enforce local isolation and the configured HTTPS web boundary."""

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings
        self.allowed_origins = {allowed.casefold() for allowed in settings.allowed_origins}
        self.trusted_hosts = {host.casefold() for host in settings.trusted_hosts}
        self.trusted_proxy_networks = tuple(
            ipaddress.ip_network(value) for value in settings.trusted_proxy_cidrs
        )
        self.auth_limiter = _AuthFailureLimiter(settings.auth_attempts_per_minute)

    async def _respond(
        self, response: JSONResponse, scope: Scope, receive: Receive, send: Send
    ) -> None:
        async def secure_send(message: Message) -> None:
            _security_headers(
                message,
                web_enabled=self.settings.web_enabled,
                path=scope["path"],
            )
            await send(message)

        await response(scope, receive, secure_send)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        client = scope.get("client")
        client_host = client[0] if client is not None else ""
        is_loopback_client = _is_loopback_address(client_host)
        is_health = scope["path"] == "/api/health" and scope["method"] in {"GET", "HEAD"}
        is_internal_health = is_health and is_loopback_client
        host = _parse_host_header(headers.get("host", ""))

        if self.settings.web_enabled:
            if is_internal_health:
                if host not in _LOCAL_HOSTNAMES:
                    await self._respond(
                        JSONResponse(status_code=400, content={"detail": "Invalid Host header."}),
                        scope,
                        receive,
                        send,
                    )
                    return
            elif host not in self.trusted_hosts:
                await self._respond(
                    JSONResponse(status_code=400, content={"detail": "Invalid Host header."}),
                    scope,
                    receive,
                    send,
                )
                return
            # Render's direct instance health checks do not guarantee a forwarded
            # scheme. Keep this narrow data-free route outside TLS/auth checks while
            # retaining the exact Host check above.
            if not is_health:
                if self.settings.trust_proxy_headers:
                    try:
                        client_address = ipaddress.ip_address(client_host)
                    except ValueError:
                        client_address = None
                    trusted_proxy = self.settings.managed_proxy or (
                        client_address is not None
                        and any(
                            client_address in network for network in self.trusted_proxy_networks
                        )
                    )
                    if not trusted_proxy:
                        await self._respond(
                            JSONResponse(
                                status_code=400,
                                content={
                                    "detail": "Request did not arrive through a trusted proxy."
                                },
                            ),
                            scope,
                            receive,
                            send,
                        )
                        return
                    transport_is_secure = headers.get("x-forwarded-proto", "").casefold() == "https"
                else:
                    transport_is_secure = scope.get("scheme") == "https"
                if not transport_is_secure:
                    await self._respond(
                        JSONResponse(status_code=400, content={"detail": "HTTPS is required."}),
                        scope,
                        receive,
                        send,
                    )
                    return
        else:
            if not is_loopback_client:
                await self._respond(
                    JSONResponse(
                        status_code=403, content={"detail": "Only local clients are allowed."}
                    ),
                    scope,
                    receive,
                    send,
                )
                return
            if host not in _LOCAL_HOSTNAMES:
                await self._respond(
                    JSONResponse(status_code=400, content={"detail": "Invalid Host header."}),
                    scope,
                    receive,
                    send,
                )
                return

        origin = headers.get("origin")
        if origin is not None and origin.casefold() not in self.allowed_origins:
            await self._respond(
                JSONResponse(status_code=403, content={"detail": "Origin is not allowed."}),
                scope,
                receive,
                send,
            )
            return
        if self.settings.web_enabled and scope["method"] in _UNSAFE_METHODS and origin is None:
            await self._respond(
                JSONResponse(status_code=403, content={"detail": "An allowed Origin is required."}),
                scope,
                receive,
                send,
            )
            return

        if self.settings.web_authentication_enabled and not is_health:
            if not _valid_basic_credentials(headers.get("authorization"), self.settings):
                retry_after = self.auth_limiter.record_or_limit(client_host)
                response_headers = {
                    "WWW-Authenticate": _AUTH_CHALLENGE,
                    "Cache-Control": "no-store",
                }
                if retry_after is not None:
                    response_headers["Retry-After"] = str(retry_after)
                    response = JSONResponse(
                        status_code=429,
                        content={"detail": "Too many authentication attempts."},
                        headers=response_headers,
                    )
                else:
                    response = JSONResponse(
                        status_code=401,
                        content={"detail": "Authentication required."},
                        headers=response_headers,
                    )
                await self._respond(response, scope, receive, send)
                return
            self.auth_limiter.clear(client_host)

        content_length = headers.get("content-length")
        if content_length is not None:
            try:
                length = int(content_length)
            except ValueError:
                await self._respond(
                    JSONResponse(status_code=400, content={"detail": "Invalid Content-Length."}),
                    scope,
                    receive,
                    send,
                )
                return
            if length < 0:
                await self._respond(
                    JSONResponse(status_code=400, content={"detail": "Invalid Content-Length."}),
                    scope,
                    receive,
                    send,
                )
                return
            if length > self.settings.max_request_bytes:
                await self._respond(
                    JSONResponse(status_code=413, content={"detail": "Request body is too large."}),
                    scope,
                    receive,
                    send,
                )
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

        async def secure_send(message: Message) -> None:
            _security_headers(
                message,
                web_enabled=self.settings.web_enabled,
                path=scope["path"],
            )
            await send(message)

        try:
            await self.app(scope, limited_receive, secure_send)
        except _RequestTooLarge:
            response = JSONResponse(
                status_code=413, content={"detail": "Request body is too large."}
            )
            await self._respond(response, scope, receive, send)
