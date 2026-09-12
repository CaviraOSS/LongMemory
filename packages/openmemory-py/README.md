<!--
     __                      __  ___
    / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
   / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
  / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/

 cavira oss (c) 2026  -  nullure (c) 2026
 ----------------------------------------------------------
 file  : packages/openmemory-py/README.md
 usage : supports LongMemory readme
-->

# openmemory-py has moved

This compatibility distribution is deprecated. Install the LongMemory Python SDK instead:

```bash
pip uninstall openmemory-py
pip install longmemory-sdk
```

Update imports:

```python
from longmemory import LongMemory
```

The compatibility package depends on `longmemory-sdk` and forwards the legacy `openmemory` import namespace during migration.
