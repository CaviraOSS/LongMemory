<!--
     __                      __  ___
    / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
   / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
  / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/

 cavira oss (c) 2026  -  nullure (c) 2026
 ----------------------------------------------------------
 file  : packages/openmemory-js/MIGRATION.md
 usage : supports LongMemory migration
-->

# Migrating from openmemory-js

```bash
npm uninstall openmemory-js
npm install longmemory
```

Update imports from `openmemory-js` to `longmemory` and replace `opm` with the `longmemory` CLI. Version 2 of this package is a temporary forwarding bridge.
