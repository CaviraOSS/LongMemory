/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
*                      /____/                                 /____/
*
*  cavira oss (c) 2026  -  nullure (c) 2026
*  ----------------------------------------------------------
*  file  : tools/script-entry.mjs
*  usage : detects direct CLI execution, including through a symlinked path
*/

import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const is_direct_execution = (module_url) => {
    if (!process.argv[1]) return false;
    try {
        // Node resolves import.meta.url to the real path, so compare against the
        // real path of argv[1]; a symlinked invocation would otherwise no-op.
        return realpathSync(process.argv[1]) === fileURLToPath(module_url);
    } catch {
        return module_url === pathToFileURL(process.argv[1]).href;
    }
};
