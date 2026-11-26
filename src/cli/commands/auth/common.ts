/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ `/ __ `/ __ `/ /|/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/ /_/\____/_/   \__, /
                     /____/
*
*  cavira oss (c) 2026  -  nullure (c) 2026
*  ----------------------------------------------------------
*  file  : src/cli/commands/auth/common.ts
*  usage : shared helpers for control-plane CLI commands
*/

import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function write_token_file(path: string, token: string): string {
    const target = resolve(path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, `${token}\n`, { mode: 0o600 });
    // writeFileSync only applies the mode when it creates the file; an existing file keeps its old mode.
    chmodSync(target, 0o600);
    return target;
}

// A legacy database stores every node under the `default` user. Worlds are not partitioned, so any
// world means the file predates control mode and must not be silently detached from `default`.
export async function memory_has_worlds(path: string): Promise<boolean> {
    if (path === ':memory:' || !existsSync(path)) return false;
    const { createMemory } = await import('../../../core/create_memory.js');
    const memory = createMemory({ store: 'sqlite', db_path: path, readonly: true, tenant_id: 'default', user_id: 'default' });
    try {
        return (await memory.listWorlds()).length > 0;
    } finally {
        await memory.close();
    }
}
