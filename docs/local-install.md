<!--
     __                      __  ___
    / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
   / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
  / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/

 cavira oss (c) 2026  -  nullure (c) 2026
 ==========================================================
 file  : docs/local-install.md
 usage : installs this checkout for all supported hosts in three modes
-->

# Install LongMemory locally

`npm run install:local` builds this checkout and wires it into supported hosts. It never installs the registry package, never starts a server, and never enables a systemd unit.

## Prerequisites

- Node 20 or newer and npm.
- `pnpm` is optional; without it the installer runs `npm exec --yes --package=pnpm@11.5.2 -- pnpm`.
- The Codex CLI (`codex`) is optional. When missing, the installer prints a warning and skips the Codex plugin.
- POSIX paths. `~/.local/bin` should be on `PATH`; the installer warns if it is not.

## Three modes

| Mode | Flags | What it does |
|---|---|---|
| **No flags** (legacy) | — | Builds CLI, wrapper, `server.env`, systemd unit, OpenCode plugin, Codex plugin. |
| **Host mode** | `--hosts <list>` or `--all-hosts` | Builds CLI and wrapper; configures only selected hosts for local stdio. No server artifacts, no OpenCode, no Codex. |
| **Team mode** | `--team <url> --token-file <path> (--space <space>) --hosts <list>` or `--all-hosts` | Verifies token with `GET /v1/whoami`, writes `0600` client config, configures only selected hosts. No server artifacts, no OpenCode, no Codex. |

## No flags (legacy)

```sh
npm run install:local
```

Preview without touching anything:

```sh
npm run install:local -- --dry-run
```

What changes (exact legacy behavior):

| Path | Change |
|---|---|
| `~/.local/bin/longmemory` | `0755` wrapper that runs this checkout's `dist/cli/index.js` |
| `~/.config/opencode/opencode.json` | Adds the local plugin path and a `longmemory` stdio MCP server; existing entries and file mode are kept |
| `~/.codex/config.toml` | Registers this repository as a local marketplace and installs `longmemory@longmemory`; the previous file is backed up when it changes |
| `~/.config/longmemory/server.env` | `0600` file with a generated `LONGMEMORY_API_KEY` |
| `~/.config/systemd/user/longmemory.service` | `0644` unit for the optional shared server; left disabled, or skipped when `systemd --user` is unavailable |
| `~/.local/share/longmemory/` | `0700` data directory for the shared server database |

Existing files are copied to `<file>.bak.<UTC timestamp>` before they change, including the Codex config. Writes are atomic and follow symlinks, so dotfile-managed configs keep their links. Re-running is safe: the key is reused, and the OpenCode plugin and MCP entries are not duplicated. A user-managed `longmemory` OpenCode entry is never overwritten.

If `~/.config/opencode/opencode.jsonc` exists without `opencode.json`, the installer stops and asks you to rename it or add the entry manually; it does not create a lower-precedence `opencode.json` beside it. When both files exist, it warns that the `.jsonc` file may take precedence.

systemd cannot represent every path. If the wrapper or env path contains a single quote, double quote, backslash, newline, or `%`, the unit step fails with a clear message; move the checkout or home directory to a representable path.

### Activate each workspace

Installation is automatic, but memory creation is deliberately explicit. In every workspace you want memory for, run once:

```sh
longmemory init
```

Then restart OpenCode and Codex so they load the new plugin and MCP server. Sessions in that workspace use its own `.longmemory/project.db`.

### Optional shared server

The generated unit is inactive. To run one server that all clients can share:

```sh
systemctl --user enable --now longmemory.service
```

The server reads its API key and database path from `~/.config/longmemory/server.env`. Point clients at the server's HTTP MCP endpoint only if you want shared memory; the default installation uses local stdio per project.

## Host mode

```sh
npm run install:local -- --hosts cursor,windsurf,copilot
# or
npm run install:local -- --all-hosts
```

Builds the CLI and wrapper, then configures only the selected hosts. No `server.env`, no systemd unit, no OpenCode, no Codex.

### Per-host paths (host mode)

| Host | Path | Notes |
|---|---|---|
| Claude Code | Repository marketplace + `claude plugin install longmemory@longmemory` | Skips with warning when `claude` CLI is absent. |
| Kilo Code | `~/.config/kilo/kilo.jsonc` (or `.json`) | Merges `mcp.longmemory` and a `file://` plugin entry; preserves comments. |
| Cursor | `~/.cursor/mcp.json` | `mcpServers` container; prints portable bundle path for one-time Customize → Plugins install. |
| Windsurf/Devin | `~/.config/devin/mcp_config.json` | `mcpServers` container; with `--project-level`, also writes `.windsurf/rules/longmemory.md`. |
| Antigravity | `agy plugin install` | Fallback: copies to `~/.gemini/config/plugins/longmemory` (backing up existing). |
| Copilot | `code --add-mcp` | Fallback: merges `~/.config/Code/User/mcp.json` (VS Code user config). With `--project-level`, writes `.vscode/mcp.json`. |

Each modified file gets a timestamped backup. A user-managed `longmemory` entry is never overwritten.

## Team mode

```sh
npm run install:local -- --team https://memory.example.com --token-file ~/bob.token --space team:core --all-hosts
```

Requires `--token-file` and a host selection (`--hosts` or `--all-hosts`). The token file is read once, validated (trimmed, non-empty, no internal whitespace or control characters), and used for `GET /v1/whoami` with a plain headers object `{ authorization: 'Bearer <token>', accept: 'application/json' }`. The response must include `data.user_id` and `data.spaces`.

- `401` → `authentication_failed`; no client config written.
- Other non-2xx → `server_error <status>`; no client config written.
- Network failure → `server_unreachable`; no client config written.
- Requested `--space` (e.g. `team:core`) absent from `data.spaces` → `space_forbidden`.

On success, writes `{ server_url, token, space, project_id: null }` to `~/.config/longmemory/client.json` at `0600` (directory `0700`). The token file is **never** copied into host configs.

Then configures only the selected hosts (same per-host paths as host mode).

## Project-level templates

```sh
npm run install:local -- --hosts windsurf,copilot --project-level --workspace /path/to/repo
```

`--workspace` requires `--project-level`; `--project-level` requires a non-empty host selection and defaults the workspace to the current directory. Both are errors without a host selection because project templates are only written for selected hosts.

- Windsurf: writes `<workspace>/.windsurf/rules/longmemory.md` from the template.
- Copilot: writes `<workspace>/.vscode/mcp.json` with `merge_vscode_mcp_config`.

## Dry run

```sh
npm run install:local -- --team https://memory.example.com --token-file ~/bob.token --hosts cursor --dry-run
```

`--dry-run` prints every planned path and merge result, makes **no writes**, **no network calls**, and calls **no host CLIs**. It computes the exact merge so the log describes the exact change.

## Rollback

Every modified file gets a timestamped backup through `write_with_backup`.

- Host configs: restore the listed `.bak.<timestamp>` file next to the modified config.
- Client config (team mode): remove `~/.config/longmemory/client.json` with `longmemory auth:logout` or manually.
- CLI wrapper: remove `~/.local/bin/longmemory`.
- Server artifacts (legacy mode only): remove `~/.config/longmemory/server.env`, `~/.config/systemd/user/longmemory.service`, and `~/.local/share/longmemory/`.

The repository and its build output are untouched by rollback.

## Troubleshooting

- `longmemory: command not found`: add `~/.local/bin` to `PATH`.
- `install failed at build`: fix the reported pnpm/TypeScript error and re-run.
- Codex plugin missing (legacy mode): install the `codex` CLI, then re-run the installer.
- Malformed OpenCode config (legacy mode): the installer aborts without writing; fix the JSON shape (`plugins` array, `mcp.servers` object) and re-run.
- Missing host CLI (`claude`, `kilo`, `agy`, `code`): the installer prints a warning and uses a documented fallback; it never fails the install for an absent CLI.
- Rejected token (`authentication_failed`): verify the token file content and server URL; run `tokens:list` on the server to check revocation/expiry.
- User-managed `longmemory` entry: the installer never overwrites it; the log shows `kept`.
- JSONC file the installer refuses to corrupt: `kilo.json(c)` must be a JSON object; arrays, `null`, or malformed JSON throw with a message matching `/object/`, `/mcp/`, `/plugin/`, or `/JSON/`.