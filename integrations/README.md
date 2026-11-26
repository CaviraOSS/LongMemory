<!--
     __                      __  ___
    / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
   / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
  / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/

 cavira oss (c) 2026  -  nullure (c) 2026
 ==========================================================
 file  : integrations/README.md
 usage : configures the LongMemory README.md integration
-->

# LongMemory Integrations

LongMemory integrates through native host extension contracts rather than a parallel memory or transcript-import protocol.

## n8n community node

Package: [`n8n-nodes-longmemory`](n8n-nodes-longmemory)

The node supports Recall, Store, Explain, and Stats operations and declares `usableAsTool: true` for n8n AI Agents. Credentials are stored by n8n and sent as a bearer token.

```bash
pnpm --dir integrations/n8n-nodes-longmemory build
```

For local n8n development, link or install the package directory using n8n's community-node development workflow. Before publishing, use the official `n8n-node lint` and provenance-enabled release workflow required by n8n.

## OpenClaw and Agent Plugins hosts

Bundle: [`longmemory-agent-plugin`](longmemory-agent-plugin)

This is an Agent Plugins 1.0 bundle with:

- `plugin.json` validated against the official plugin schema
- `mcp.json` launching the installed `longmemory` CLI over stdio
- `skills/longmemory/SKILL.md` teaching safe memory use

```bash
longmemory serve --mcp-http
openclaw plugins install ./integrations/longmemory-agent-plugin
openclaw plugins inspect longmemory
openclaw gateway restart
```

The bundle stores no credentials. For a shared team server, run `longmemory auth:login --server <url> --token-file <path>`; the stdio proxy reads `~/.config/longmemory/client.json`. For local memory, no login is required. Override the `longmemory` server `command` or `args` in operator configuration when the CLI is not on `PATH`.

The same standards-based bundle can be consumed by Agent Plugins 1.0 hosts including Cursor and compatible VS Code agent environments. Prefer this shared bundle over host-specific copies when the host implements the standard directly.

## Claude Code

Plugin: [`claude-code-longmemory`](claude-code-longmemory)

The native Claude Code package provides a namespaced LongMemory skill and starts the installed `longmemory` CLI over stdio. It contains no hooks or executable plugin code.

```bash
pnpm integration:claude:validate
claude --plugin-dir ./integrations/claude-code-longmemory
```

## Codex and ChatGPT desktop

Plugin: [`codex-longmemory`](codex-longmemory)

The native `.codex-plugin` package includes an Agent Skill and bundled stdio MCP server. The repository catalog at `../.agents/plugins/marketplace.json` makes it discoverable as a local Codex marketplace:

```bash
codex plugin marketplace add .
```

Install `longmemory` from the Plugins Directory after restarting the ChatGPT desktop app. A public ChatGPT plugin submission additionally requires registering the hosted LongMemory MCP endpoint and mapping its `plugin_asdk_app` identifier in `.app.json`.

## Gemini CLI

Extension: [`gemini-cli-longmemory`](gemini-cli-longmemory)

The extension adds startup guidance and launches LongMemory over local stdio.

```bash
gemini extensions link ./integrations/gemini-cli-longmemory
```

Restart Gemini CLI after linking or installing the extension.

## Antigravity

Plugin: [`antigravity-longmemory`](antigravity-longmemory)

The native Antigravity plugin bundles a local stdio MCP entry, an always-on memory rule, and the shared skill. It contains no credentials; the stdio proxy reads the LongMemory client config.

```bash
agy plugin validate --strict ./integrations/antigravity-longmemory
agy plugin install ./integrations/antigravity-longmemory
agy plugin list
```

## Kilo Code

Plugin: [`kilo-longmemory`](kilo-longmemory)

The Kilo plugin adds a local stdio MCP entry when the config has none, injects one bounded cached context packet per task, and fails open on memory errors. Load it from the `plugin` array in `kilo.json` or `kilo.jsonc`.

## OpenCode

Plugin: [`opencode-longmemory`](opencode-longmemory)

The OpenCode V2 plugin injects one bounded, untrusted LongMemory project brief
for each new user task and caches it through tool-driven follow-up requests. It
uses the local CLI in dry-run mode by default, or the authenticated shared
project-context API when configured for a team.

```bash
npm --prefix ./integrations/opencode-longmemory install
```

Add the plugin directory and the included local MCP server template to the
target project's `opencode.jsonc`, then restart OpenCode. See the package
README for local and shared-server configuration.

## Cline, Continue, and LibreChat

Templates: [`mcp-configs`](mcp-configs)

- Cline uses local stdio with an empty `autoApprove` list.
- Continue uses a standalone `.continue/mcpServers/` block for agent mode.
- LibreChat uses authenticated Streamable HTTP and includes the required Docker-host address allowlist.

See the configuration-pack README for exact placement and deployment notes.

## Dify

Dify has a native HTTP MCP tool integration. Start LongMemory with `--mcp-http`, then add `http://127.0.0.1:7331/mcp` under **Integrations > Tools > MCP** with bearer authentication. No duplicate Dify plugin runtime is necessary.

## Flowise

Use Flowise's **Custom MCP** tool with the same Streamable HTTP endpoint and bearer header. This exposes LongMemory tools inside Assistants, Chatflows, and Agentflows without embedding another memory engine.

## Grok (xAI)

Guide: [`grok-connectors.md`](grok-connectors.md)

Grok's Bring Your Own MCP connector calls LongMemory's Streamable HTTP MCP endpoint over the public internet, so it is the one integration here that requires a reachable URL rather than local stdio. The guide covers starting LongMemory with `--mcp-http`, exposing it via a tunnel for testing or a TLS-terminated deployment for persistent use, and adding the connector at `grok.com/connectors`.

## Agent frameworks

Examples: [`frameworks`](frameworks)

Runnable Python examples use each framework's current native MCP client:

- CrewAI: `Agent.mcps` with `MCPServerStdio`
- AutoGen: `McpWorkbench` with `StdioServerParams`
- LangGraph/LangChain: `MultiServerMCPClient` tools passed to `create_agent`
- OpenAI Agents SDK: `MCPServerStdio` attached through `Agent.mcp_servers`
- PydanticAI: `MCPToolset` backed by FastMCP `StdioTransport`

Each example launches `longmemory mcp --project current`, handles the Windows npm shim, and includes safe memory-use instructions. Install only the chosen framework's requirements:

```powershell
cd integrations/frameworks/crewai
py -3.11 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python main.py
```

For hosted deployments, switch the framework's native client to Streamable HTTP and connect it to `/mcp`. Keep tenant, user, project, agent, and framework identity fixed in server configuration; never derive identity from model-generated tool arguments.

## Security

- Plugin artifacts contain no credential values.
- The n8n package uses n8n's credential type and request helper.
- The OpenClaw bundle contains no in-process runtime code.
- Claude Code, Codex, and Gemini CLI packages contain no hooks or executable runtime code.
- Antigravity and Kilo packages contain no credentials; both ship secret-free stdio MCP entries.
- Copilot and Windsurf workspace packs contain no credentials; both ship secret-free stdio MCP entries.
- Local editor integrations use stdio and leave tool approval to the host.
- Framework examples use native MCP lifecycle management and do not embed LongMemory storage.
- The LibreChat template resolves its bearer token from `LONGMEMORY_API_KEY`.
- MCP writes remain governed by LongMemory's project scope, allowlist, read-only mode, and audit log.
- External host stores are never modified by LongMemory.

## Host matrix

All seven host artifacts are secret-free; credentials live in the client config (`~/.config/longmemory/client.json`, `0600`) or host secret stores.

| Package | Host | Transport | Install |
|---|---|---|---|
| `claude-code-longmemory` | Claude Code | stdio | marketplace or `--plugin-dir` |
| `kilo-longmemory` | Kilo Code | stdio | `file://` plugin entry plus JSONC merge |
| `antigravity-longmemory` | Antigravity | stdio | `agy plugin install` |
| `longmemory-agent-plugin` | Cursor, Windsurf, Copilot | stdio | Agent Plugins install |
| `copilot-longmemory` | Copilot | stdio | workspace pack (`.vscode/mcp.json` + `.github/instructions/`) |
| `windsurf-longmemory` | Windsurf/Devin | stdio | `mcp_config.json` + `.windsurf/rules/longmemory.md` |
| `mcp-configs` | Cline, Continue, LibreChat, Cursor, Windsurf, VS Code | stdio or HTTP | merge a template |
