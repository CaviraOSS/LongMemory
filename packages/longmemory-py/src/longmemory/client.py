#      __                      __  ___
#     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
#    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
#   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
#  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
#                     /____/                                 /____/
#
#  cavira oss (c) 2026  -  nullure (c) 2026
#  ----------------------------------------------------------
#  file  : packages/longmemory-py/src/longmemory/client.py
#  usage : implements the LongMemory Python HTTP client

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping, Sequence
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from .errors import LongMemoryConnectionError, LongMemoryError

JsonObject = dict[str, Any]
QueryValue = str | int | float | bool


class LongMemory:
    """Synchronous client for a self-hosted LongMemory server."""

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:7331",
        *,
        api_key: str | None = None,
        timeout: float = 30.0,
        user_id: str | None = None,
    ) -> None:
        if timeout <= 0:
            raise ValueError("timeout must be greater than zero")
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.user_id = user_id

    def request(
        self,
        method: str,
        path: str,
        *,
        body: Mapping[str, Any] | None = None,
        query: Mapping[str, QueryValue | Sequence[QueryValue] | None] | None = None,
    ) -> Any:
        """Call a LongMemory API route and return the unwrapped ``data`` value."""

        url = f"{self.base_url}/{path.lstrip('/')}"
        if query:
            items: list[tuple[str, QueryValue]] = []
            for key, value in query.items():
                if value is None:
                    continue
                if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
                    items.extend((key, item) for item in value)
                else:
                    items.append((key, value))
            if items:
                url = f"{url}?{urlencode(items, doseq=True)}"

        encoded = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
        headers = {
            "Accept": "application/json",
            "User-Agent": "longmemory-sdk/1.0.0",
        }
        if encoded is not None:
            headers["Content-Type"] = "application/json"
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        request = Request(url, data=encoded, headers=headers, method=method.upper())
        try:
            with urlopen(request, timeout=self.timeout) as response:
                payload = self._decode(response.read(), response.status)
        except HTTPError as error:
            payload = self._decode(error.read(), error.code, allow_error=True)
            detail = payload.get("error") if isinstance(payload, dict) else None
            if isinstance(detail, dict):
                raise LongMemoryError(
                    detail.get("message", str(error)),
                    status=error.code,
                    code=detail.get("code"),
                    meta=payload.get("meta"),
                ) from None
            raise LongMemoryError(str(error), status=error.code) from None
        except URLError as error:
            raise LongMemoryConnectionError(
                f"Unable to reach LongMemory at {self.base_url}: {error.reason}"
            ) from error

        if isinstance(payload, dict) and "error" in payload:
            detail = payload["error"]
            if isinstance(detail, dict):
                raise LongMemoryError(
                    detail.get("message", "LongMemory request failed"),
                    status=None,
                    code=detail.get("code"),
                    meta=payload.get("meta"),
                )
        return payload.get("data") if isinstance(payload, dict) and "data" in payload else payload

    @staticmethod
    def _decode(content: bytes, status: int, *, allow_error: bool = False) -> Any:
        if not content:
            return None
        try:
            return json.loads(content.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            if allow_error:
                return {"error": {"code": "invalid_response", "message": f"HTTP {status} returned invalid JSON"}}
            raise LongMemoryError(
                f"HTTP {status} returned invalid JSON", status=status, code="invalid_response"
            ) from error

    def health(self) -> JsonObject:
        return self.request("GET", "/health")

    def ingest(self, text: str, *, user_id: str | None = None, **fields: Any) -> JsonObject:
        identity = user_id or self.user_id
        if not identity:
            raise ValueError("user_id is required for ingest")
        return self.request("POST", "/v1/ingest", body={"user_id": identity, "text": text, **fields})

    def recall(self, text: str, *, mode: str = "associative", **fields: Any) -> JsonObject:
        return self.request("POST", "/v1/recall", body={"text": text, "mode": mode, **fields})

    def explain(self, memory_id: str) -> JsonObject:
        return self.request("GET", f"/v1/explain/{quote(memory_id, safe='')}")

    def worlds(self, *, zone: str | None = None, limit: int | None = None) -> list[JsonObject]:
        return self.request("GET", "/v1/worlds", query={"zone": zone, "limit": limit})

    def world(self, world_id: str) -> JsonObject:
        return self.request("GET", f"/v1/worlds/{quote(world_id, safe='')}")

    def entity(self, entity_id: str) -> JsonObject:
        return self.request("GET", f"/v1/entities/{quote(entity_id, safe='')}")

    def timeline(
        self,
        *,
        text: str | None = None,
        now: int | None = None,
        valid_time: int | None = None,
        recorded_time: int | None = None,
        world_id: str | None = None,
        entity_names: Sequence[str] | None = None,
    ) -> JsonObject:
        return self.request(
            "GET",
            "/v1/timeline",
            query={
                "text": text,
                "now": now,
                "valid_time": valid_time,
                "recorded_time": recorded_time,
                "world_id": world_id,
                "entity_names": entity_names,
            },
        )

    def stats(self) -> JsonObject:
        return self.request("GET", "/v1/stats")

    def runtime(self) -> JsonObject:
        return self.request("GET", "/v1/runtime")

    def close(self) -> None:
        """Compatibility no-op; urllib opens one connection per request."""

    def __enter__(self) -> LongMemory:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


class AsyncLongMemory:
    """Async facade over the zero-dependency synchronous HTTP client."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self._client = LongMemory(*args, **kwargs)

    async def request(self, method: str, path: str, **kwargs: Any) -> Any:
        return await asyncio.to_thread(self._client.request, method, path, **kwargs)

    async def health(self) -> JsonObject:
        return await asyncio.to_thread(self._client.health)

    async def ingest(self, text: str, *, user_id: str | None = None, **fields: Any) -> JsonObject:
        return await asyncio.to_thread(self._client.ingest, text, user_id=user_id, **fields)

    async def recall(self, text: str, *, mode: str = "associative", **fields: Any) -> JsonObject:
        return await asyncio.to_thread(self._client.recall, text, mode=mode, **fields)

    async def explain(self, memory_id: str) -> JsonObject:
        return await asyncio.to_thread(self._client.explain, memory_id)

    async def worlds(self, *, zone: str | None = None, limit: int | None = None) -> list[JsonObject]:
        return await asyncio.to_thread(self._client.worlds, zone=zone, limit=limit)

    async def world(self, world_id: str) -> JsonObject:
        return await asyncio.to_thread(self._client.world, world_id)

    async def entity(self, entity_id: str) -> JsonObject:
        return await asyncio.to_thread(self._client.entity, entity_id)

    async def timeline(self, **kwargs: Any) -> JsonObject:
        return await asyncio.to_thread(self._client.timeline, **kwargs)

    async def stats(self) -> JsonObject:
        return await asyncio.to_thread(self._client.stats)

    async def runtime(self) -> JsonObject:
        return await asyncio.to_thread(self._client.runtime)

    async def close(self) -> None:
        self._client.close()

    async def __aenter__(self) -> AsyncLongMemory:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()
