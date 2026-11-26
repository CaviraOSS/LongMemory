<!--
     __                      __  ___
    / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
   / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
  / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/

 cavira oss (c) 2026  -  nullure (c) 2026
 ==========================================================
 file  : integrations/windsurf-longmemory/README.md
 usage : configures the LongMemory Windsurf and Devin workspace pack
-->

# LongMemory for Windsurf and Devin

Durable personal and team memory for Windsurf and Devin, provided by a secret-free MCP configuration and an always-on project rule.

## What it bundles

- `mcp_config.json`, a secret-free stdio MCP entry using the `mcpServers` container: `longmemory mcp --project current`.
- `.windsurf/rules/longmemory.md`, an always-on project rule for the LongMemory workflow.

## Install

Merge `mcp_config.json` into `~/.config/devin/mcp_config.json` to add the LongMemory server at user level. Copy `.windsurf/rules/longmemory.md` into the repository's `.windsurf/rules/` directory to apply the memory policy to the workspace.

The portable bundle at `integrations/longmemory-agent-plugin` is another option when the host supports Agent Plugins.

## Prerequisites

`longmemory` must be on `PATH`. The stdio server reads `~/.config/longmemory/client.json` when a team server was configured with `longmemory auth:login`, and otherwise uses local memory. The pack stores no credentials.

## Verify

Reload the Windsurf or Devin window and confirm the LongMemory server is running. Then call `longmemory_who_am_i` and `longmemory_project_context` for the current task.
