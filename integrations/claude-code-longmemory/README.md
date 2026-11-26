<!--
     __                      __  ___
    / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
   / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
  / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/

 cavira oss (c) 2026  -  nullure (c) 2026
 ==========================================================
 file  : integrations/claude-code-longmemory/README.md
 usage : configures the LongMemory claude-code-longmemory integration
-->

# LongMemory for Claude Code

A native Claude Code plugin containing the shared LongMemory skill and a local
stdio MCP server configuration. It has no hooks or executable plugin code.

Prerequisite: install the `longmemory` CLI. For a shared server, run
`longmemory auth:login --server <url>` once; the stdio server reads
`~/.config/longmemory/client.json`. Local mode needs no login.

## Install from the repository marketplace

From a checkout of this repository:

```bash
claude plugin marketplace add ./
claude plugin install longmemory@longmemory
```

For a published repository, pass the GitHub repository instead:

```bash
claude plugin marketplace add CaviraOSS/LongMemory
claude plugin install longmemory@longmemory
```

## Validate

```bash
claude plugin validate ./integrations/claude-code-longmemory --strict
claude plugin validate ./.claude-plugin/marketplace.json --strict
```

## Develop against the checkout

```bash
claude --plugin-dir ./integrations/claude-code-longmemory
```

The plugin-scoped tools appear as `longmemory_*` (or a host-prefixed variant);
the shared skill resolves them by canonical suffix.
