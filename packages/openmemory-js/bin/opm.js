#!/usr/bin/env node
/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/
 *
 *  cavira oss (c) 2026  -  nullure (c) 2026
 *  ----------------------------------------------------------
 *  file  : packages/openmemory-js/bin/opm.js
 *  usage : forwards legacy CLI commands to the LongMemory binary
 */

import { spawnSync } from 'node:child_process';

console.error('openmemory-js is deprecated; install and use longmemory');
const command = process.platform === 'win32' ? 'longmemory.cmd' : 'longmemory';
const result = spawnSync(command, process.argv.slice(2), {
    shell: process.platform === 'win32',
    stdio: 'inherit',
});
if (result.error) {
    console.error(result.error.message);
    process.exitCode = 1;
} else {
    process.exitCode = result.status ?? 1;
}
