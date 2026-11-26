<!--
     __                      __  ___
    / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
   / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
  / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/

 cavira oss (c) 2026  -  nullure (c) 2026
 ==========================================================
 file  : integrations/copilot-longmemory/README.md
 usage : configures the LongMemory GitHub Copilot workspace pack
-->

# LongMemory for GitHub Copilot

Durable personal and team memory for GitHub Copilot in VS Code, provided by a workspace MCP configuration and a repository instruction file.

## What it bundles

- `.vscode/mcp.json`, a secret-free stdio MCP entry: `longmemory mcp --project current`.
- `.github/instructions/longmemory.instructions.md`, an always-on instruction file scoped with `applyTo: "**"`.

## Install

Copy `.vscode/mcp.json` into the workspace's `.vscode/` directory so Copilot can start the LongMemory MCP server. Alternatively, copy `.github/instructions/` into the repository to apply the memory policy to every Copilot request.

VS Code stores user-level servers in its own `mcp.json`; `code --add-mcp` is the CLI path for adding a server at user level. The portable bundle at `integrations/longmemory-agent-plugin` is another option when the host supports Agent Plugins.

## Prerequisites

`longmemory` must be on `PATH`. The stdio server reads `~/.config/longmemory/client.json` when a team server was configured with `longmemory auth:login`, and otherwise uses local memory. The pack stores no credentials.

## Verify

Open the workspace in VS Code, start Copilot Chat in agent mode, and confirm the LongMemory tools are listed. Then call `longmemory_who_am_i` and `longmemory_project_context` for the current task.
