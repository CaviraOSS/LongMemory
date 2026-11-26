<!--
     __                      __  ___
    / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
   / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
  / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/

 cavira oss (c) 2026  -  nullure (c) 2026
 ==========================================================
 file  : integrations/longmemory-agent-plugin/README.md
 usage : configures the portable LongMemory Agent Plugins bundle
-->

# LongMemory Agent Plugin

A portable Agent Plugins 1.0 bundle for Cursor, GitHub Copilot, Devin, and
Windsurf. It contributes the shared LongMemory skill and a secret-free stdio MCP
server; it contains no executable plugin runtime code.

## Prerequisite

Install the `longmemory` CLI, then either keep local mode or point it at a
server:

```bash
longmemory auth:login --server https://memory.example.com
```

`auth:login` writes the bearer token to `~/.config/longmemory/client.json` with
`0600` permissions. The bundle reads that file through `longmemory mcp`, so no
credential belongs in this directory.

## Install

### Cursor

Open **Customize -> Plugins**, then install this folder
(`integrations/longmemory-agent-plugin`).

### GitHub Copilot

Install the folder through VS Code Agent Plugins, or register the same stdio
server from a terminal:

```bash
code --add-mcp '{"name":"longmemory","command":"longmemory","args":["mcp","--project","current"]}'
```

### Devin and Windsurf

Install this bundle, or copy the project templates from
`integrations/windsurf-longmemory` when the host reads workspace configuration
instead of plugins.

## Direct HTTP override

A host that prefers native remote MCP can point its own MCP configuration at
`http://127.0.0.1:7331/mcp` and keep the bearer token in that host's secret
store. The bundle itself stays secret-free.

## Migrating from `LONGMEMORY_API_KEY`

The old bundle required `LONGMEMORY_API_KEY` in the host environment. That
requirement is gone: credentials now live in `~/.config/longmemory/client.json`
and are written by `longmemory auth:login`. Remove `LONGMEMORY_API_KEY` from host
configuration after logging in.
