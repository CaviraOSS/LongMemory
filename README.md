<!--
     __                      __  ___
    / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
   / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
  / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/

 cavira oss (c) 2026  -  nullure (c) 2026
 ==========================================================
 file  : README.md
 usage : introduces LongMemory, its architecture, integrations, and deployment options
-->

# LongMemory

> **Durable, temporal, governed memory for AI agents. Not just RAG. Not just a vector database. Local-first and self-hosted.**

[![npm](https://img.shields.io/npm/v/longmemory.svg)](https://www.npmjs.com/package/longmemory)
[![PyPI](https://img.shields.io/pypi/v/longmemory-sdk.svg)](https://pypi.org/project/longmemory-sdk/)
[![VS Code](https://img.shields.io/badge/VS%20Code-LongMemory-007ACC?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=CaviraOSS.longmemory-vscode)
[![Container](https://img.shields.io/badge/GHCR-longmemory-2496ED?logo=docker)](https://github.com/CaviraOSS/LongMemory/pkgs/container/longmemory)
[![License](https://img.shields.io/github/license/CaviraOSS/LongMemory)](LICENSE)

[![Watch Video](https://img.youtube.com/vi/tREFsh3J0b0/maxresdefault.jpg)](https://www.youtube.com/watch?v=tREFsh3J0b0)

<a href="https://trendshift.io/repositories/15645?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-15645" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/15645/daily?language=TypeScript" alt="CaviraOSS%2FLongMemory | Trendshift" width="250" height="55"/></a>

LongMemory is a cognitive memory engine for LLM applications and autonomous agents.

- Durable local-first storage with SQLite
- Immutable content, provenance, and temporal truth
- Strict, historical, associative, grounded, and multilingual recall
- Explainable evidence selection and token-bounded context
- Governed project memory, Skills, Chat Memory, LLM-Wiki, and CodeGraph
- One TypeScript engine across npm, CLI, HTTP, MCP, dashboard, and VS Code
- Native integrations for agent hosts, automation tools, and Python frameworks

Your model stays stateless. **Your application stops being amnesiac.**

---

## 1. Use It in 10 Seconds

### Install as a library

```bash
npm install longmemory
```

```ts
import { createMemory } from 'longmemory';

const memory = await createMemory();
await memory.ingest({
    user_id: 'alice',
    text: 'I prefer TypeScript for backend services',
});

const result = await memory.recall({
    text: 'What language does Alice prefer?',
    mode: 'strict',
});

console.log(result);
await memory.close();
```

No service or external database is required for in-memory use.

For optional evidence-grounded answers with your own model, use the exported
`answer_from_evidence` adapter. It accepts authorized evidence, validates cited
excerpts, and makes at most one model call; ordinary recall is unchanged.
See [docs/answering.md](docs/answering.md) for policies, limits, and integration.

### Persist with SQLite

```ts
const memory = await createMemory({
    store: 'sqlite',
    db_path: './longmemory.db',
    tenant_id: 'acme',
    user_id: 'alice',
});
```

Reopening the same database restores nodes, worlds, entities, edges, temporal history, grounding, and lifecycle state.

### Install the CLI

```bash
npm install --global longmemory
longmemory init
longmemory recall "current project priorities" --mode associative
```

### Call a self-hosted server from Python

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

memory.ingest("I prefer TypeScript")
result = memory.recall("What language do I prefer?", mode="strict")
```

The Python package is a zero-dependency HTTP client. The Hydrograph engine remains in the self-hosted TypeScript service. See [docs/python-sdk.md](docs/python-sdk.md).

---

## 2. Run as a Service

### From source

```bash
git clone https://github.com/CaviraOSS/LongMemory.git
cd LongMemory
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

The API listens on `http://127.0.0.1:7331` by default.

### Docker

```bash
docker run --rm \
  -p 7331:7331 \
  -v longmemory-data:/data \
  -e LONGMEMORY_API_KEY=change-me \
  ghcr.io/caviraoss/longmemory:latest
```

### Docker Compose

```bash
cp .env.example .env
docker compose up --build -d longmemory
```

Include the dashboard:

```bash
docker compose --profile ui up --build -d
```

- API and MCP: `http://127.0.0.1:7331`
- Dashboard: `http://127.0.0.1:3000`
- Health: `http://127.0.0.1:7331/health`

---

## 3. Why LongMemory

Most systems called memory are retrieval pipelines:

1. Split text into chunks.
2. Embed the chunks.
3. Return the nearest vectors.

That does not establish what was true at a particular time, whether a new fact superseded an old one, which source is authoritative, who may see it, or why a result belongs in context.

LongMemory models those concerns directly:

- **Temporal truth:** recorded time and valid time are separate.
- **Immutable memory:** content, vectors, hashes, and provenance are not rewritten by recall or decay.
- **Executable graph:** typed relationships participate in recall and explanation.
- **Governance:** project, tenant, user, team, role, agent, task, and framework scope are enforced.
- **Lifecycle:** deterministic decay, explicit reinforcement, consolidation, compression, and reconsolidation.
- **Evidence:** recall is bounded by relevance, contradictions, grounding, permissions, and token cost.

See [Why.md](Why.md) for the design rationale.

---

## 4. Recall Modes

```ts
const strict = await memory.recall({
    text: 'What is the current deployment region?',
    mode: 'strict',
});

const historical = await memory.recall({
    text: 'What was the deployment region in January?',
    mode: 'historical',
    valid_time: Date.UTC(2026, 0, 15),
});

const associative = await memory.recall({
    text: 'Incidents related to the payment migration',
    mode: 'associative',
});

const grounded = await memory.recall({
    text: 'Which production endpoint is currently live?',
    mode: 'world_grounded',
});
```

Strict recall applies temporal, contradiction, contract, confidence, and grounding gates. Historical recall preserves superseded truth. Associative recall follows semantic, lexical, entity, activation, and graph signals. World-grounded recall requires current external evidence.

---

## 5. Features

- **Hydrograph memory substrate** with immutable nodes, executable edges, worlds, entities, facets, and traces.
- **Temporal reasoning** with point-in-time truth, event ordering, supersession, and stale-evidence controls.
- **Multilingual memory** with script detection, code switching, transliteration, and cross-language embeddings.
- **Project memory** for architecture, decisions, tasks, conventions, failures, handoffs, and code impact.
- **Governed assets** for Chat Memory, Skills, LLM-Wiki, and CodeGraph with lifecycle and ACL policy.
- **Session porter** for Claude Code, Codex, OpenCode, Gemini CLI, Copilot Chat, Cline, and raw harness logs.
- **Connectors** for repositories, local files, Markdown, web content, feeds, cloud documents, and provider APIs.
- **Embeddings** through OpenAI-compatible APIs, Gemini, AWS Bedrock, Ollama, Siray, and local HTTP models.
- **Operational surfaces** through HTTP, MCP, dashboard, VS Code, n8n, and framework-native MCP clients.
- **Auditable benchmarks** for LongMemEval, LoCoMo, BEAM, retrieval quality, temporal behavior, and latency.

---

## 6. MCP and Agent Integrations — Make Every Tool Remember

LongMemory connects to your entire AI stack through **Model Context Protocol (MCP)**, the open standard for agent-tool communication. Every integration runs the same governed memory engine — your decisions, code facts, and project history are consistent whether you're in VS Code, Claude, Codex, or an automated pipeline.

### Quick Start: Local stdio (no server needed)

```bash
longmemory mcp --db .longmemory/project.db --project current
```

This runs entirely in-process. Point any MCP-compatible host at this command and memory works immediately.

### Quick Start: Team Server (shared memory)

```bash
# 1. Start the server
longmemory serve --mcp-http

# 2. Configure your client once
longmemory auth:login --server http://127.0.0.1:7331 --token-file ~/my.token --space team:core

# 3. Every host reads the same memory
```

---

### Integration Catalog

| Category | Integration | Install | What Changes In Your Day |
|----------|-------------|---------|--------------------------|
| **AI Assistants** | [Claude Code](integrations/claude-code-longmemory) | `claude --plugin-dir ./integrations/claude-code-longmemory` | Claude recalls project decisions, architecture, and past incidents automatically. No more re-explaining context. |
| | [Codex / ChatGPT Desktop](integrations/codex-longmemory) | `codex plugin marketplace add .` then install from Plugins Directory | ChatGPT remembers your codebase conventions, rollback procedures, and team preferences across sessions. |
| | [Gemini CLI](integrations/gemini-cli-longmemory) | `gemini extensions link ./integrations/gemini-cli-longmemory` | Gemini recalls relevant memories before every task — design docs, past bugs, migration guides. |
| | [OpenCode](integrations/opencode-longmemory) | Add plugin path to `opencode.jsonc` | OpenCode injects a bounded project brief at the start of every new user task, cached for follow-ups. |
| **IDEs & Editors** | [VS Code Extension](apps/vscode-extension) | `pnpm extension:package` → install `.vsix` | Activity bar browser, status bar, in-editor recall, AI change session recording (Copilot/Cursor edits → durable memories), session import from 7+ sources. |
| | [Copilot](integrations/copilot-longmemory) | Copy `.vscode/mcp.json` to workspace or `code --add-mcp` | Copilot Chat gets project-aware context: architecture, decisions, failures, code facts — all token-bounded. |
| | [Cursor](integrations/mcp-configs/cursor.json) | Merge into `~/.cursor/mcp.json` | Cursor's agent mode searches governed memory, not just embeddings. Finds the *right* memory with temporal and contradiction gates. |
| | [Windsurf / Devin](integrations/windsurf-longmemory) | Merge `mcp_config.json` + copy `.windsurf/rules/` | Always-on project rule teaches Windsurf to call `longmemory_who_am_i` and `longmemory_project_context` before substantial work. |
| | [Agent Plugins Bundle](integrations/longmemory-agent-plugin) | Install via OpenClaw, Cursor, or compatible hosts | Single portable bundle (Agent Plugins 1.0) works across Cursor, Copilot, Devin, Windsurf. Secret-free stdio MCP + shared skill. |
| **Automation** | [n8n](integrations/n8n-nodes-longmemory) | `pnpm --dir integrations/n8n-nodes-longmemory build` | Build workflows that *remember*: ingest decisions from PRs, recall context for incident response, schedule decay maintenance. |
| | [Cline](integrations/mcp-configs/cline.json) | Merge into Cline's MCP settings | Cline uses LongMemory tools as native capabilities — recall, ingest, project context. |
| | [Continue](integrations/mcp-configs/continue.yaml) | Copy to `.continue/mcpServers/` | Continue agent mode searches governed memory with strict/associative/historical modes. |
| | [LibreChat](integrations/mcp-configs/librechat.yaml) | Merge into `librechat.yaml` | Multi-user chat with shared team memory; bearer auth from host environment. |
| **Low-Code Platforms** | [Dify](integrations/README.md#dify) | Add HTTP MCP under **Integrations → Tools → MCP** | Dify Assistants/Chatflows call LongMemory tools natively — no custom memory engine needed. |
| | [Flowise](integrations/README.md#flowise) | Use **Custom MCP** tool | Agentflows and Assistants get temporal, governed memory with zero embedding pipeline setup. |
| **Frameworks** | CrewAI, AutoGen, LangGraph, OpenAI Agents SDK, PydanticAI | See `integrations/frameworks/` | Native MCP clients (`MCPServerStdio`, `McpWorkbench`, `MultiServerMCPClient`) — same memory engine, framework-native ergonomics. |
| **Custom / Remote** | Grok (xAI) | [grok-connectors.md](integrations/grok-connectors.md) | Bring-your-own-MCP connector calls LongMemory's HTTP endpoint over public internet. |

---

### What "Improves Daily Life" Means Concretely

| Before LongMemory | After LongMemory |
|-------------------|------------------|
| **Re-explain context** to every new AI session | AI *already knows* project decisions, architecture, rollback procedures, incident history |
| **Search Slack/Notion** for "how did we handle X?" | `longmemory recall "X"` — returns governed evidence with provenance, not chat logs |
| **Forget past bugs** until they recur | `longmemory project context "current task"` — injects relevant failures, mitigations, code facts |
| **AI suggests wrong pattern** (old convention) | Governed memory enforces *current* decisions; superseded facts are marked, not deleted |
| **Team knowledge siloed** in individuals | Shared `team:<id>` space — all assistants, all teammates see the same durable memory |
| **No audit trail** for why a decision was made | `longmemory explain <memory-id>` — full provenance: who, when, source, supersession chain |
| **Memory grows unbounded** | Bounded decay, explicit reinforcement, token budgets — memory stays relevant and cheap |

---

### Pick Your Starting Point

| You Are... | Start Here |
|------------|------------|
| **Solo developer, VS Code + Copilot** | [VS Code Extension](apps/vscode-extension) → `longmemory init` → `longmemory auth:login` for team memory |
| **Team using Claude Code / Codex** | [Claude](integrations/claude-code-longmemory) or [Codex](integrations/codex-longmemory) plugins + shared server |
| **Cursor / Windsurf user** | [Cursor config](integrations/mcp-configs/cursor.json) or [Windsurf pack](integrations/windsurf-longmemory) |
| **Automation engineer (n8n, Dify, Flowise)** | [n8n node](integrations/n8n-nodes-longmemory) or [Dify/Flowise setup](integrations/README.md#dify) |
| **Python framework user (LangGraph, CrewAI, AutoGen, etc.)** | [Framework examples](integrations/frameworks/) — native MCP client, 5-minute setup |
| **Want to try without installing anything** | `npm install longmemory` → `createMemory()` in 30 seconds (Section 1) |

---

### All Integrations Are Secret-Free

- **No tokens in config files** — credentials live only in `~/.config/longmemory/client.json` (0600) or host secret stores
- **MCP stdio by default** — no network exposure unless you enable `--mcp-http`
- **Governed at the engine** — project, tenant, user, team, role, agent, framework scope enforced on every tool call
- **Auditable** — every recall/ingest emits structured JSON; dashboard shows activity, decay, timeline

---

See [integrations/README.md](integrations/README.md) for the complete matrix, [docs/mcp.md](docs/mcp.md) for tool details, and [docs/team-memory.md](docs/team-memory.md) for personal/team space operations.

---

## 7. Temporal and Project Memory

```ts
import { createProjectMemory } from 'longmemory';

const projects = await createProjectMemory({
    tenant_id: 'cavira',
    organization_id: 'CaviraOSS',
    project_id: 'longmemory',
    name: 'LongMemory',
    store: 'sqlite',
    db_path: './longmemory.db',
});

await projects.ingestProjectEvent('longmemory', {
    kind: 'decision',
    topic: 'persistence',
    text: 'Use SQLite for local-first persistence',
    source_type: 'architecture_note',
});

const context = await projects.getProjectContext('longmemory', 'prepare the next release');
```

Project context combines relevant architecture, current decisions, open tasks, failures, code facts, matched Skills, conflicts, and governed asset loadouts under one token budget.

---

## 8. CLI

```bash
longmemory init
longmemory tui
longmemory status --memories 20 --json
longmemory ingest "Remember the rollback procedure" --type procedure
longmemory recall "What is the rollback procedure?" --mode associative
longmemory memory list --limit 50
longmemory project context "prepare the next release"
longmemory maintenance decay --all
longmemory maintenance reinforce <memory-id>
longmemory skill match "run the release checklist" --agent reviewer
longmemory asset loadout "prepare the release" --agent reviewer --framework codex
longmemory code impact createMemory
longmemory detect
longmemory session discover --from claude-code
longmemory port --from claude-code --to longmemory --all
longmemory session wiki --from gemini-cli --all --name "Project knowledge"
longmemory serve --mcp-http
```

Finite commands emit stable JSON outside a TTY or when `--json` is supplied. The session porter reads supported coding-agent stores without modifying them. See [docs/cli.md](docs/cli.md).

---

## 9. Dashboard and VS Code

The Next.js dashboard provides health, memory browsing, ingestion, search, project selection, activity, decay, settings, timelines, and memory-aware chat through a same-origin API proxy.

```bash
pnpm --dir dashboard build
pnpm --dir dashboard start
```

The VS Code extension provides an activity-bar browser, status bar, recall, project context, explanation, reinforcement, explicit decay, session import, and reviewed AI-change capture.

```bash
pnpm extension:package
```

The generated package is `apps/vscode-extension/longmemory-vscode-0.2.0.vsix`.

---

## 10. Architecture

```mermaid
graph TB
  INPUT[Events, documents, sessions] --> INGEST[Immutable ingest pipeline]
  INGEST --> GRAPH[(Hydrograph)]
  GRAPH --> STRICT[Strict and historical recall]
  GRAPH --> ASSOC[Associative recall]
  GRAPH --> GROUND[World-grounded recall]
  GRAPH --> PROJECT[Project memory and governed assets]
  GRAPH --> SQLITE[(SQLite)]
  STRICT --> CONTEXT[Explainable bounded context]
  ASSOC --> CONTEXT
  GROUND --> CONTEXT
  PROJECT --> MCP[MCP tools, resources, prompts]
  CONTEXT --> API[Library, CLI, HTTP]
  MCP --> AGENTS[Agents, IDEs, automation]
  API --> UI[Dashboard and VS Code]
```

Read [ARCHITECTURE.md](ARCHITECTURE.md) and [docs/architecture.md](docs/architecture.md) for subsystem details.

---

## 11. Deployment Options

| Platform       | Configuration          | What it deploys                           |
| -------------- | ---------------------- | ----------------------------------------- |
| Docker         | `Dockerfile`           | API and Streamable HTTP MCP               |
| Docker Compose | `docker-compose.yml`   | API/MCP plus optional dashboard           |
| Heroku         | `app.json`             | Containerized API/MCP                     |
| Railway        | `railway.json`         | Containerized API/MCP                     |
| Render         | `render.yaml`          | API/MCP with persistent disk              |
| DigitalOcean   | `.do/spec.yaml`        | App Platform API/MCP service              |
| Vercel         | `vercel.json`          | Dashboard; configure `LONGMEMORY_API_URL` |
| Windows        | `start-longmemory.ps1` | Background local API/MCP process          |

For hosted API deployments, set `LONGMEMORY_API_KEY`, mount persistent storage at `/data`, and terminate TLS at the platform edge. Vercel hosts only the stateless dashboard and requires a separately deployed LongMemory API.

---

## 12. Benchmarks

```bash
pnpm bench
pnpm bench:ci
pnpm bench:full
```

The benchmark harness publishes explicit manifests, dataset completion, evidence metrics, answer judgments, temporal categories, latency percentiles, and N/A reasons. Official scorecards fail closed on incomplete datasets or semantic embedding fallback. See [benchmarks/README.md](benchmarks/README.md).

---

## 13. Migration

Import supported SQLite, JSON, or JSONL memory:

```bash
longmemory migrate \
  --from ./legacy.db \
  --to ./longmemory.db \
  --report ./migration-report.json
```

Import coding-agent conversations as governed Chat Memory:

```bash
longmemory port --from codex --to longmemory --all
```

See [MIGRATION.md](MIGRATION.md) and [docs/migration.md](docs/migration.md).

Legacy package migration:

```bash
npm uninstall openmemory-js && npm install longmemory
pip uninstall openmemory-py && pip install longmemory-sdk
```

`openmemory-js@2` and `openmemory-py@2` are forwarding bridges for existing installations. New applications should use `longmemory` and `longmemory-sdk` directly. PyPI's unrelated `longmemory` name is owned by another project, so the official distribution is `longmemory-sdk` while the import remains `longmemory`.

---

## 14. Release and Operations

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm release:check
pnpm pack
pnpm extension:package
```

`release:check` validates branding, types, integration manifests, the benchmark smoke gate, the root build, extension build, and dashboard production build.

Useful Make targets:

```bash
make install
make build
make check
make docker-up
make dashboard
```

---

## 15. Security

LongMemory is local-first, but network deployment still requires explicit controls:

- Protect API and MCP routes with `LONGMEMORY_API_KEY`.
- Restrict allowed origins and terminate TLS at the edge.
- Keep connector and embedding credentials outside repository files.
- Treat recalled content as untrusted evidence, not authorization.
- Preserve server-bound user, project, agent, and framework identity.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

---

## 16. Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), [GOVERNANCE.md](GOVERNANCE.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before contributing.

- Issues: https://github.com/CaviraOSS/LongMemory/issues
- Discussions: https://github.com/CaviraOSS/LongMemory/discussions
- Changelog: [CHANGELOG.md](CHANGELOG.md)

---

## 17. License

LongMemory is licensed under the [Apache License 2.0](LICENSE). The separately
published n8n community node uses MIT as required by n8n's strict package
validator.

## Contributors

<!-- readme: contributors -start -->
<table>
	<tbody>
		<tr>
            <td align="center">
                <a href="https://github.com/nullure">
                    <img src="https://avatars.githubusercontent.com/u/81895400?v=4" width="100;" alt="nullure"/>
                    <br />
                    <sub><b>Morven</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/dontbanmeplz">
                    <img src="https://avatars.githubusercontent.com/u/59851616?v=4" width="100;" alt="dontbanmeplz"/>
                    <br />
                    <sub><b>Chis</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/amihos">
                    <img src="https://avatars.githubusercontent.com/u/35190548?v=4" width="100;" alt="amihos"/>
                    <br />
                    <sub><b>Hossein Amirkhalili</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/DKB0512">
                    <img src="https://avatars.githubusercontent.com/u/23116307?v=4" width="100;" alt="DKB0512"/>
                    <br />
                    <sub><b>DKB</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/stevo1403">
                    <img src="https://avatars.githubusercontent.com/u/34807365?v=4" width="100;" alt="stevo1403"/>
                    <br />
                    <sub><b>Stephen Adebayo</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/mameikagou">
                    <img src="https://avatars.githubusercontent.com/u/116348059?v=4" width="100;" alt="mameikagou"/>
                    <br />
                    <sub><b>mrlonely</b></sub>
                </a>
            </td>
		</tr>
		<tr>
            <td align="center">
                <a href="https://github.com/haosenwang1018">
                    <img src="https://avatars.githubusercontent.com/u/167664334?v=4" width="100;" alt="haosenwang1018"/>
                    <br />
                    <sub><b>Sense_wang</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/recabasic">
                    <img src="https://avatars.githubusercontent.com/u/102372274?v=4" width="100;" alt="recabasic"/>
                    <br />
                    <sub><b>Elvoro</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/zfaustk">
                    <img src="https://avatars.githubusercontent.com/u/4340287?v=4" width="100;" alt="zfaustk"/>
                    <br />
                    <sub><b>Clio</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/suyua9">
                    <img src="https://avatars.githubusercontent.com/u/273297082?v=4" width="100;" alt="suyua9"/>
                    <br />
                    <sub><b>suyua9</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/vincenzopalazzo">
                    <img src="https://avatars.githubusercontent.com/u/17150045?v=4" width="100;" alt="vincenzopalazzo"/>
                    <br />
                    <sub><b>Vincenzo Palazzo</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/msris108">
                    <img src="https://avatars.githubusercontent.com/u/43115330?v=4" width="100;" alt="msris108"/>
                    <br />
                    <sub><b>Sriram M</b></sub>
                </a>
            </td>
		</tr>
		<tr>
            <td align="center">
                <a href="https://github.com/fparrav">
                    <img src="https://avatars.githubusercontent.com/u/9319430?v=4" width="100;" alt="fparrav"/>
                    <br />
                    <sub><b>Felipe Parra</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/DoKoB0512">
                    <img src="https://avatars.githubusercontent.com/u/123281216?v=4" width="100;" alt="DoKoB0512"/>
                    <br />
                    <sub><b>DoKoB0512</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/whiterabb17">
                    <img src="https://avatars.githubusercontent.com/u/90134688?v=4" width="100;" alt="whiterabb17"/>
                    <br />
                    <sub><b>MistrHyde</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/octo-patch">
                    <img src="https://avatars.githubusercontent.com/u/266937838?v=4" width="100;" alt="octo-patch"/>
                    <br />
                    <sub><b>Octopus</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/therexone">
                    <img src="https://avatars.githubusercontent.com/u/27387245?v=4" width="100;" alt="therexone"/>
                    <br />
                    <sub><b>Ayush Singh</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/kishan0725">
                    <img src="https://avatars.githubusercontent.com/u/36665975?v=4" width="100;" alt="kishan0725"/>
                    <br />
                    <sub><b>Kishan Lal</b></sub>
                </a>
            </td>
		</tr>
		<tr>
            <td align="center">
                <a href="https://github.com/pc-quiknode">
                    <img src="https://avatars.githubusercontent.com/u/126496711?v=4" width="100;" alt="pc-quiknode"/>
                    <br />
                    <sub><b>Peter Chung</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/muhammad-fiaz">
                    <img src="https://avatars.githubusercontent.com/u/75434191?v=4" width="100;" alt="muhammad-fiaz"/>
                    <br />
                    <sub><b>Muhammad Fiaz</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/jasonkneen">
                    <img src="https://avatars.githubusercontent.com/u/502002?v=4" width="100;" alt="jasonkneen"/>
                    <br />
                    <sub><b>Jason Kneen</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/Hchunjun">
                    <img src="https://avatars.githubusercontent.com/u/11238835?v=4" width="100;" alt="Hchunjun"/>
                    <br />
                    <sub><b>shan</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/naabakkcrypto">
                    <img src="https://avatars.githubusercontent.com/u/258882739?v=4" width="100;" alt="naabakkcrypto"/>
                    <br />
                    <sub><b>Naabakk</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/mikemikimike">
                    <img src="https://avatars.githubusercontent.com/u/186855910?v=4" width="100;" alt="mikemikimike"/>
                    <br />
                    <sub><b>mikemikimike</b></sub>
                </a>
            </td>
		</tr>
		<tr>
            <td align="center">
                <a href="https://github.com/mgajewskik">
                    <img src="https://avatars.githubusercontent.com/u/47600161?v=4" width="100;" alt="mgajewskik"/>
                    <br />
                    <sub><b>Maciej Gajewski</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/ajitam">
                    <img src="https://avatars.githubusercontent.com/u/672661?v=4" width="100;" alt="ajitam"/>
                    <br />
                    <sub><b>Matija Urh</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/machj8968-lab">
                    <img src="https://avatars.githubusercontent.com/u/274563644?v=4" width="100;" alt="machj8968-lab"/>
                    <br />
                    <sub><b>machj8968-lab</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/buyua9">
                    <img src="https://avatars.githubusercontent.com/u/274236111?v=4" width="100;" alt="buyua9"/>
                    <br />
                    <sub><b>buyua9</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/aziham">
                    <img src="https://avatars.githubusercontent.com/u/94932043?v=4" width="100;" alt="aziham"/>
                    <br />
                    <sub><b>Hamza</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/GPT-AGI">
                    <img src="https://avatars.githubusercontent.com/u/181050363?v=4" width="100;" alt="GPT-AGI"/>
                    <br />
                    <sub><b>Ting Zhang</b></sub>
                </a>
            </td>
		</tr>
		<tr>
            <td align="center">
                <a href="https://github.com/RockinPaul">
                    <img src="https://avatars.githubusercontent.com/u/3741448?v=4" width="100;" alt="RockinPaul"/>
                    <br />
                    <sub><b>Paul Zarudnev</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/oantoshchenko">
                    <img src="https://avatars.githubusercontent.com/u/1749531?v=4" width="100;" alt="oantoshchenko"/>
                    <br />
                    <sub><b>Oleksandr Antoshchenko</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/lwsinclair">
                    <img src="https://avatars.githubusercontent.com/u/2829939?v=4" width="100;" alt="lwsinclair"/>
                    <br />
                    <sub><b>Lawrence Sinclair</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/jungdaesuh">
                    <img src="https://avatars.githubusercontent.com/u/78460559?v=4" width="100;" alt="jungdaesuh"/>
                    <br />
                    <sub><b>jungdaesuh</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/josephgoksu">
                    <img src="https://avatars.githubusercontent.com/u/6523823?v=4" width="100;" alt="josephgoksu"/>
                    <br />
                    <sub><b>Joseph Goksu</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/EikoocS">
                    <img src="https://avatars.githubusercontent.com/u/80829508?v=4" width="100;" alt="EikoocS"/>
                    <br />
                    <sub><b>EikoocS</b></sub>
                </a>
            </td>
		</tr>
		<tr>
            <td align="center">
                <a href="https://github.com/Dhravya">
                    <img src="https://avatars.githubusercontent.com/u/63950637?v=4" width="100;" alt="Dhravya"/>
                    <br />
                    <sub><b>Dhravya Shah</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/dflor003">
                    <img src="https://avatars.githubusercontent.com/u/103017?v=4" width="100;" alt="dflor003"/>
                    <br />
                    <sub><b>Danil Flores</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/DAESA24">
                    <img src="https://avatars.githubusercontent.com/u/173488786?v=4" width="100;" alt="DAESA24"/>
                    <br />
                    <sub><b>DAESA24</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/ammesonb">
                    <img src="https://avatars.githubusercontent.com/u/2522710?v=4" width="100;" alt="ammesonb"/>
                    <br />
                    <sub><b>Brett Ammeson</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/auto-pr-bot">
                    <img src="https://avatars.githubusercontent.com/u/245575329?v=4" width="100;" alt="auto-pr-bot"/>
                    <br />
                    <sub><b>auto-pr-bot</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/anush008">
                    <img src="https://avatars.githubusercontent.com/u/46051506?v=4" width="100;" alt="anush008"/>
                    <br />
                    <sub><b>Anush</b></sub>
                </a>
            </td>
		</tr>
		<tr>
            <td align="center">
                <a href="https://github.com/annelchavez-11594">
                    <img src="https://avatars.githubusercontent.com/u/271067077?v=4" width="100;" alt="annelchavez-11594"/>
                    <br />
                    <sub><b>Annel Chavez</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/atao2004">
                    <img src="https://avatars.githubusercontent.com/u/148929819?v=4" width="100;" alt="atao2004"/>
                    <br />
                    <sub><b>Anna Tao</b></sub>
                </a>
            </td>
		</tr>
	<tbody>
</table>
<!-- readme: contributors -end -->
