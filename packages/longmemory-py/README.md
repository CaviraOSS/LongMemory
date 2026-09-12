<!--
     __                      __  ___
    / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
   / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
  / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/

 cavira oss (c) 2026  -  nullure (c) 2026
 ----------------------------------------------------------
 file  : packages/longmemory-py/README.md
 usage : documents the LongMemory Python HTTP SDK
-->

# LongMemory Python SDK

A zero-dependency Python client for a self-hosted LongMemory server. The memory engine remains in the TypeScript service; this package only calls its authenticated HTTP API.

The PyPI distribution is named `longmemory-sdk` because the unrelated `longmemory` name is already registered on PyPI. The import namespace is still `longmemory`.

```bash
pip install longmemory-sdk
```

```python
from longmemory import LongMemory

memory = LongMemory(
    "http://127.0.0.1:7331",
    api_key="change-me",
    user_id="alice",
)

memory.ingest("I prefer TypeScript", facet_hint="semantic")
result = memory.recall("What language do I prefer?", mode="strict")
print(result)
```

Async use:

```python
from longmemory import AsyncLongMemory

async with AsyncLongMemory(api_key="change-me", user_id="alice") as memory:
    await memory.ingest("The release is Friday")
    result = await memory.recall("When is the release?")
```

Available methods: `health`, `ingest`, `recall`, `explain`, `worlds`, `world`, `entity`, `timeline`, `stats`, `runtime`, and generic `request`.

Start the server with:

```bash
npm install --global longmemory
LONGMEMORY_API_KEY=change-me longmemory serve --mcp-http
```
