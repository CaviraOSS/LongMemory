<!--
     __                      __  ___
    / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
   / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
  / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 /_____/\____/_/ /_/\__,_/_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/

 cavira oss (c) 2026  -  nullure (c) 2026
 ==========================================================
 file  : integrations/opencode-longmemory/README.md
 usage : installs the LongMemory OpenCode integration
-->

# LongMemory for OpenCode

This OpenCode V2 server plugin automatically adds a bounded LongMemory project
brief to every new user task. The brief is evidence only: OpenCode and its
model must not treat it as instructions or authorization. Tool-driven follow-up
requests reuse the same brief until the user submits another task.

The default mode is workspace-local and read-only. It runs:

```bash
longmemory project context "<task>" --json --dry-run --token-budget 2048
```

Initialize the workspace yourself before the first task. If LongMemory is not
initialized or unavailable, OpenCode continues without injected memory.

## Install from this repository

Install the package dependencies, then reference this directory from the target
workspace's `opencode.jsonc`:

```bash
npm --prefix ./integrations/opencode-longmemory install
```

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["./integrations/opencode-longmemory"],
  "mcp": {
    "servers": {
      "longmemory": {
        "type": "local",
        "command": ["longmemory", "mcp", "--project", "current"],
        "codemode": false
      }
    }
  }
}
```

The included [`opencode.jsonc`](opencode.jsonc) is the same local template.
Restart OpenCode after adding or changing the plugin.

## Shared team memory

To retrieve automatic context from a shared server, configure the environment
that starts OpenCode:

```bash
export LONGMEMORY_API_URL=https://memory.example.com
export LONGMEMORY_API_KEY=replace-with-a-server-key
export LONGMEMORY_PROJECT_ID=current
```

The plugin calls authenticated `POST /v1/project/context` with a ten-second
timeout. The server fixes identity from its own configuration; the plugin does
not send a user identity. Configure direct MCP tools separately with a remote
server:

```jsonc
{
  "mcp": {
    "servers": {
      "longmemory": {
        "type": "remote",
        "url": "https://memory.example.com/mcp",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer {env:LONGMEMORY_API_KEY}"
        },
        "codemode": false
      }
    }
  }
}
```

Set `LONGMEMORY_TOKEN_BUDGET` to an integer from 64 through 1,000,000 to change
the default 2,048-token context budget. Invalid values suppress automatic
context rather than sending an unbounded request.

## Safety

- The plugin does not initialize databases, ingest prompts, save transcripts,
  or write decisions automatically.
- Local context uses `--dry-run`; a missing database returns no context.
- Shared context requires an explicit URL and API key, and the server enforces
  its own project, identity, and asset-access gates.
- Returned JSON is escaped and enclosed in a LongMemory evidence block.
