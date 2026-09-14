<!--
     __                      __  ___
    / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
   / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
  / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/

 cavira oss (c) 2026  -  nullure (c) 2026
 ==========================================================
 file  : docs/ai-rules.md
 usage : documents LongMemory ai rules
-->

# AI Rules

- Preserve immutable memory content identity and project isolation.
- Re-ingesting identical durable events must not reactivate retired content or
  reapply edge handlers. Automatic update ordering uses valid time rather than
  arrival order; explicit supersession remains a separate caller decision.
- Never claim VS Code edit-origin attribution that the stable API cannot prove.
- Explicit agent sessions may be recorded; heuristic candidates require review.
- Exclude sensitive/generated paths, redact credential-like lines, and bound all
  captured document, session, and patch data.
- Keep finite recall and inspection commands read-only.
- Skill updates create superseding versions; code impact must remain tied to
  persisted source snapshots; session import preserves original timestamps.
- Only approved, unexpired assets may enter loadouts. ACL denies override allows;
  visibility never grants manage/assign/share; runtime identity is authoritative.
- Conversation-to-wiki conversion must remain deterministic and provenance-rich;
  do not present transcript normalization as an AI-generated factual summary.
- CLI main detection must compare canonical real paths so linked npm shims work.
  Keep only one extension publisher installed for the `longmemory.*` namespace.
