<!--
     __                      __  ___
    / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
   / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
  / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/

 cavira oss (c) 2026  -  nullure (c) 2026
 ==========================================================
 file  : docs/ai-context.md
 usage : documents LongMemory ai context
-->

# AI Context

- The product, package, CLI, environment prefix, extension namespace, routes,
  integrations, and active project documentation are named LongMemory.
- Comment-capable active files carry the Cavira header rendered in their native
  comment syntax. Strict JSON, generated binary metadata, binary assets, the
  header template, and n8n's byte-exact ESLint config are explicit exceptions.
- LongMemory uses one Hydrograph engine across the library, CLI, server, MCP,
  dashboard, and VS Code extension.
- `answer_from_evidence` is an optional TypeScript answering adapter above recall,
  using a caller-owned model and already-authorized evidence. It performs one
  generation with bounded output and exact citation checks, no automatic search
  or memory writes. Citation validity is not proof of semantic correctness.
- The VS Code extension uses stable CLI JSON and workspace project scope; it
  does not duplicate engine behavior.
- AI code changes are stored as compact redacted patches with provenance and
  attribution confidence, not as silent full-file snapshots.
- Project memory includes immutable reusable Skills with agent bindings,
  snapshot-derived code impact queries, and validated past-session import.
- Conversations, Skills, documents, and repositories auto-register as governed
  Chat Memory, Skill, LLM-Wiki, and CodeGraph assets with portable loadouts.
- The CLI session porter reads Claude Code, Codex, and OpenCode into one portable
  session IR, alongside Gemini CLI, VS Code Copilot Chat, Cline, and raw
  DeepSeek Harness logs, and imports immutable revisions into governed Chat
  Memory. Its TUI uses an original Library, Review, and Transfer utility flow.
- Selected portable conversations can become deterministic Markdown LLM-Wiki
  assets with source provenance, immutable revisions, and optional agent binding.
- Ingestion persists canonical entity metadata and complete dated event summaries;
  relationship indexes are owner/world scoped. Recall exposes source-linked
  bounded conversation context. Session-coverage ranking is opt-in pending gains.
- Identical-event replay preserves stored lifecycle, including after SQLite reopen;
  late historical observations cannot automatically supersede newer valid-time
  facts. Conversation appends avoid full-session membership scans. Evidence
  selection caches candidate features and pairwise redundancy; context rendering
  is query-local and rejects unrelated-session or future bundle sources.
- Associative recall treats entity identity as a constraint, calibrates and
  whitens feature columns, sparsifies typed-graph seeds, and selects evidence
  sets under token and aspect-coverage constraints.
- A bounded evidence-aware reranker uses cached speaker/assertion features,
  simple exclusion handling, and vocabulary novelty for count/list queries.
  It preserves strong counterevidence for named-subject questions and never
  changes admission gates or stored facts. `LONGMEMORY_EVIDENCE_RERANK=0`
  disables it; its fixed weights are not learned or calibrated probabilities.
- Calendar-aware recall softly promotes explicit month/year matches and simple
  relative-date evidence without hard time filtering. Its ordering policy and
  the secondary English word-variant signal can be disabled independently using
  `LONGMEMORY_CALENDAR_RERANK=0` and `LONGMEMORY_DERIVATION_RERANK=0`.
- The npm CLI entry canonicalizes junction/symlink paths; the VS Code extension
  activates at startup and exposes a persistent bottom-right memory manager.
- n8n uses a native community node package. OpenClaw uses a schema-valid Agent
  Plugins bundle with MCP and a memory workflow Skill. Dify, Flowise,
  LangGraph, CrewAI, AutoGen, OpenAI Agents, and PydanticAI use their native MCP
  client surfaces. Runnable local examples launch the installed LongMemory CLI
  over stdio and leave process lifecycle to the framework.
- Release `1.0.0` is test-free by policy: validation uses branding and release
  artifact checks, TypeScript checks, official integration validators, dependency
  audit, production builds, live API/MCP smoke checks, and package inspection.
- Deployment files cover Docker, Compose, Heroku, Railway, Render,
  DigitalOcean, and a Vercel-hosted dashboard. Stateful API deployments require
  persistent `/data`; Vercel hosts only the dashboard.
- The repository and primary packages use Apache-2.0. The n8n community package
  remains MIT because n8n's strict validator requires it.
