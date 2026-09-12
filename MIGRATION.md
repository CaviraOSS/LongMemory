<!--
     __                      __  ___
    / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
   / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
  / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/

 cavira oss (c) 2026  -  nullure (c) 2026
 ==========================================================
 file  : MIGRATION.md
 usage : supports LongMemory migration
-->

# Migration guide

## Product rename

The package, CLI, environment prefix, extension namespace, routes, and integration IDs are now LongMemory:

- npm and CLI: `longmemory`
- environment: `LONGMEMORY_*`
- workspace state: `.longmemory/`
- dashboard proxy: `/api/longmemory`
- repository: `https://github.com/CaviraOSS/LongMemory`

Application identifiers do not retain runtime aliases; registry migration is handled by temporary compatibility packages.

Package registry migration uses temporary compatibility bridges:

```bash
npm uninstall openmemory-js
npm install longmemory

pip uninstall openmemory-py
pip install longmemory-sdk
```

The npm bridge re-exports `longmemory` and forwards the legacy CLI names. The PyPI bridge depends on `longmemory-sdk` and forwards the legacy Python import namespace. The unrelated `longmemory` distribution on PyPI is not part of CaviraOSS.

## Import legacy memory data

```bash
longmemory migrate \
  --from ./legacy.db \
  --to ./longmemory.db \
  --report ./migration-report.json
```

The migration command reads supported SQLite, JSON, and JSONL data, skips corrupt or duplicate records, maps records through the current immutable ingest pipeline, restores supported relations, and writes an audit report. It refuses to overwrite a destination or migrate a database onto itself.

## Import agent sessions

```bash
longmemory detect
longmemory session discover --from claude-code
longmemory port --from claude-code --to longmemory --all
longmemory verify --from claude-code --sample 10
```

Session adapters are read-only and never modify proprietary harness stores. See [`docs/session-porter.md`](docs/session-porter.md) and [`docs/migration.md`](docs/migration.md).
