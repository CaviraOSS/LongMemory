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
*  file  : src/cli/commands/auth/logout.ts
*  usage : removes the per-user remote client config
*/

import { existsSync, rmSync } from 'node:fs';
import { client_config_path } from '../../client/client_config.js';
import type { cli_command } from '../../context/cli_context.js';
import { command_flags } from '../../context/cli_context.js';
import { emit } from '../../output/pretty.js';

export const auth_logout_command: cli_command = async (context) => {
    command_flags(context, []);
    const config_path = client_config_path(context.env);
    const removed = existsSync(config_path);
    if (!context.dry_run) rmSync(config_path, { force: true });

    emit(context, {
        ok: true, command: 'auth:logout', removed, config_path,
        ...(context.dry_run ? { dry_run: true } : {}),
    }, () => context.dry_run
        ? (removed ? `Would remove the remote login at ${config_path}.` : `No remote login to remove at ${config_path}.`)
        : (removed ? `Removed the remote login from ${config_path}.` : `No remote login to remove at ${config_path}.`));
};
