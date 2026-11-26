<!--
     __                      __  ___
    / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
   / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
  / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/

 cavira oss (c) 2026  -  nullure (c) 2026
 ==========================================================
 file  : integrations/kilo-longmemory/README.md
 usage : configures the LongMemory Kilo Code plugin
-->

# LongMemory for Kilo Code

Automatic, bounded LongMemory context for Kilo Code, plus the LongMemory MCP tools.

## What it does

- Adds `mcp.longmemory` to the Kilo config when the entry is absent.
- Injects a short memory policy into the system prompt.
- Injects one cached `/v1/project/context` packet per task when a remote server or client config is available, and falls back to `longmemory project context` for local memory.
- Fails open: a memory error never blocks the turn.

## Install

Add the plugin to the `plugin` array in `kilo.json` or `kilo.jsonc`:

```json
{
  "plugin": ["file:///absolute/path/to/longmemory/integrations/kilo-longmemory/src/index.ts"]
}
```

When the package is published or resolvable from your config directory, use the package specifier `"@caviraoss/kilo-longmemory"` in the same array instead of the `file://` path.

Add the shared skill so Kilo can load it as a workflow skill. Either copy `skills/longmemory/` into `.kilo/skills/longmemory/`, or point Kilo at the bundled directory from the repository root:

```json
{
  "skills": { "paths": ["integrations/kilo-longmemory/skills"] }
}
```

## Prerequisites

- `longmemory` must be on `PATH`; the added MCP entry runs `longmemory mcp --project current`.
- For a shared team server, run `longmemory auth:login --server <url> --token-file <path>`. The MCP entry stays secret-free; the proxy reads the client config.
- For local memory, no login is required.

## Environment

| Variable | Effect |
| --- | --- |
| `LONGMEMORY_API_URL` + `LONGMEMORY_TOKEN` (or `LONGMEMORY_API_KEY`) | Read context from that server. |
| `LONGMEMORY_SERVER_URL` + `LONGMEMORY_TOKEN` | Same, using the phase 2 server variable names. |
| `LONGMEMORY_SPACE` | Send `X-LongMemory-Space` with the context request. |
| `LONGMEMORY_PROJECT_ID` | Project id for the context request; defaults to `current`. |
| `LONGMEMORY_TOKEN_BUDGET` | Integer budget between 64 and 1000000; defaults to 2048. |
| `LONGMEMORY_CLI` | CLI executable used for the local fallback; defaults to `longmemory`. |

## Verify

```bash
node_modules/.bin/tsc --noEmit -p integrations/kilo-longmemory/tsconfig.json
node_modules/.bin/tsx --test "integrations/kilo-longmemory/test/**/*.test.ts"
kilo --print-logs --log-level DEBUG
```
