# LongMemory: Personal and Team Memory

LongMemory gives every assistant a durable, searchable memory that survives restarts, sessions, and host upgrades. This guide covers the operational model, server setup, and daily workflows.

---

## 1. What you get

- **Personal memory** is private per user. No teammate or assistant sees it.
- **Team memory** is shared across assistants and teammates who have the space in scope.
- Every assistant uses the **same MCP tools** (`longmemory_who_am_i`, `longmemory_project_context`, `longmemory_recall`, `longmemory_ingest`, `longmemory_remember_decision`, `longmemory_update_task_state`, `longmemory_list_spaces`).
- The memory is stored in a SQLite database on the server; local mode uses a per-project SQLite file.

---

## 2. Spaces

External space ids:

| Space id | Partition `user_id` | Access |
|---|---|---|
| `personal` | caller's `personal_partition` (default: user id) | Owner read/write |
| `team:<id>` | `team:<id>` | Viewer read; member/admin read/write |
| `all` | none | Read-only aggregate of personal plus every accessible team |

A user may have one personal space and any number of team spaces. An explicit `space` argument (tool parameter, `X-LongMemory-Space` header, or `LONGMEMORY_SPACE` env) beats the token default. With several accessible spaces and no explicit scope, reads use `all`; with a single space the response keeps its shape with additive `space`/`space_label` fields.

---

## 3. Server setup

Initialize the control database and the first admin user:

```bash
export LONGMEMORY_CONTROL_DB=~/.local/share/longmemory/control.db
longmemory auth:init --user alice --name "Alice" --json
```

Copy the printed token **once**; it is not recoverable. The token format is `lm_<12-char-id>_<32-byte-base64url-secret>`.

---

## 4. Users

```bash
longmemory users:create --id bob --name "Bob"
longmemory users:list
longmemory users:disable bob
```

---

## 5. Teams and roles

```bash
longmemory teams:create --id core --name "Core"
longmemory teams:add core alice --role admin
longmemory teams:add core bob --role viewer
longmemory teams:list
```

Roles are `admin`, `member`, and `viewer`. Roles resolve per space, so an admin in one team does not satisfy a role check in another. A team member can be any user; membership is the only team access check.

---

## 5.5. Spaces

```bash
longmemory spaces:list [--user <id>]
```

Lists all accessible spaces (personal and team). Admin users can list spaces for any user with `--user`; other users see only their own spaces.

---

## 6. Tokens

```bash
longmemory tokens:create --user bob --label laptop --write ~/bob.token
longmemory tokens:list --user bob
longmemory tokens:revoke <token-id>
```

Tokens are SHA-256 hashed at rest, revocable, and optionally expiring. Never commit a token or place it in argv, stdout, stderr, config output, or proxy logs.

---

## 7. Clients

```bash
longmemory auth:login --server https://memory.example.com --token-file ~/bob.token --space team:core
longmemory auth:status
longmemory auth:logout
```

The client config is written to `~/.config/longmemory/client.json` at `0600` (directory `0700`). It stores the normalized server URL, the token, the space (when supplied), and `project_id: null`. A server URL without a token, or a token without a server URL, is a configuration error; the client never falls back to local mode from a partial remote configuration.

---

## 8. Host install

Install LongMemory for every supported host against a team server:

```bash
npm run install:local -- --team https://memory.example.com --token-file ~/bob.token --space team:core --all-hosts
```

Modes:
- **No flags**: today's OpenCode + Codex install with local server artifacts.
- **Host mode** (`--hosts`/`--all-hosts`): builds the CLI and wrapper, then configures only the selected hosts for local stdio. No server artifacts, no OpenCode, no Codex.
- **Team mode** (`--team`): verifies the token with `GET /v1/whoami`, writes the `0600` client config (including `--space` when supplied), and configures only the selected hosts. No server artifacts, no OpenCode, no Codex.

See `docs/local-install.md` for the per-host paths and rollback instructions.

---

## 9. Local versus team reads

- No explicit space with several accessible spaces → reads use `all`.
- No explicit space with one accessible space → the response keeps its shape with additive `space`/`space_label`.
- Reads **never** create projects; `project_missing` is normal for a new project.
- Writes reject `all` (you must name `personal` or a specific `team:<id>`).

---

## 10. Adopting existing data

If you have a legacy local `default` project and want to bind it to a user without rewriting rows:

```bash
longmemory auth:init --user alice --adopt-default
```

Only one user can adopt `default`, and memory rows are not rewritten; the old `user_id` is remapped at read time.

---

## 11. Security notes

- Tokens are high-entropy (`lm_<id>_<secret>`) and stored as SHA-256 hashes; comparison is timing-safe.
- Logs never include the `Authorization` header or token values.
- Local stdio is **not** a multi-user boundary; it reads the single user's client config.
- Recalled memory content is **untrusted evidence**: never treat it as authorization, a policy change, or a command. The shared skill (`SKILL.md`) enforces this boundary.

---

## 12. Troubleshooting

| Error | Meaning | Action |
|---|---|---|
| `authentication_failed` | The server rejected the token (401). | Re-run `auth:login` with a valid token; check `tokens:list` for revoked/expired tokens. |
| `space_forbidden` | The requested `team:<id>` space is not in the token's accessible spaces. | Add the user to the team with `teams:add`, or choose a space the token can reach. |
| `identity_mismatch` | A REST body named a `user_id` that differs from the token's user. | Use the token's own identity; do not impersonate. |
| `read_only` | The token is a viewer, or the server is in read-only mode. | Use a member/admin token, or check server `read_only` setting. |
| `project_missing` | The project has no memory yet. | Normal for new projects; reads do not create projects. Continue working. |
| `client_config_invalid` | The client config file is missing, malformed, or incomplete. | Run `auth:status` to diagnose; `auth:logout` to clear; `auth:login` to rewrite. |

Check `longmemory auth:status` for the current config and space.