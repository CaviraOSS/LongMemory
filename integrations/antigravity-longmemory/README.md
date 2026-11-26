<!--
     __                      __  ___
    / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
   / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
  / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/

 cavira oss (c) 2026  -  nullure (c) 2026
 ==========================================================
 file  : integrations/antigravity-longmemory/README.md
 usage : configures the LongMemory Antigravity plugin
-->

# LongMemory for Antigravity

Durable personal and team memory for Google Antigravity, provided by a native plugin.

## What it bundles

- A local stdio MCP server: `longmemory mcp --project current`.
- `skills/longmemory/SKILL.md`, the shared LongMemory workflow skill.
- `rules/AGENTS.md`, an always-on memory policy.

The plugin stores no credentials. `longmemory mcp` reads `~/.config/longmemory/client.json` (written by `longmemory auth:login`) and either proxies to the team server or runs local SQLite.

## Install

```bash
agy plugin validate --strict ./integrations/antigravity-longmemory
agy plugin install ./integrations/antigravity-longmemory
agy plugin list
```

For a workspace-only install, copy the directory to `.agents/plugins/longmemory/`. For all workspaces, copy it to `~/.gemini/config/plugins/longmemory/`.

## Prerequisites

1. Install the `longmemory` CLI so it is on `PATH`. If it lives elsewhere, replace `command` in `mcp_config.json` with the absolute path.
2. For a shared team server, run `longmemory auth:login --server <url> --token-file <path>`.
3. For local memory, no login is required; `longmemory mcp` uses the local database.

## Verify

Ask Antigravity to recall this project's context, or run `longmemory auth:status`. If the MCP server cannot start, confirm `longmemory --version` works in the same shell Antigravity uses.
