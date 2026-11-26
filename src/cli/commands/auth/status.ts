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
*  file  : src/cli/commands/auth/status.ts
*  usage : reports the active remote config and verifies its token
*/

import { client_config_path, resolve_client_config } from '../../client/client_config.js';
import { client_request_error, fetch_whoami } from '../../client/whoami.js';
import type { cli_command } from '../../context/cli_context.js';
import { command_flags } from '../../context/cli_context.js';
import { cli_error, exit_codes } from '../../output/errors.js';
import { panel } from '../../output/panel.js';
import { emit } from '../../output/pretty.js';

const request_error = (error: client_request_error) => new cli_error(
    error.code,
    error.message,
    error.code === 'authentication_failed' ? exit_codes.permission : exit_codes.generic,
);

export const auth_status_command: cli_command = async (context) => {
    command_flags(context, []);
    const config_path = client_config_path(context.env);
    const resolved = resolve_client_config({}, context.env);

    if (resolved.mode === 'local') {
        emit(context, { ok: true, command: 'auth:status', mode: 'local', configured: false, config_path }, () => panel(
            'No remote config; using local SQLite.',
            context.colors,
            {
                title: 'LongMemory auth', kind: 'info', width: context.terminal_width,
                rows: [['Mode', 'local'], ['Config', config_path]],
            },
        ));
        return;
    }

    let view;
    try {
        view = await fetch_whoami({ server_url: resolved.config.server_url, token: resolved.config.token });
    } catch (error) {
        if (error instanceof client_request_error) throw request_error(error);
        throw error;
    }

    emit(context, {
        ok: true, command: 'auth:status', mode: 'remote', configured: true,
        source: resolved.source, server_url: resolved.config.server_url, config_path,
        user_id: view.user_id,
        display_name: view.display_name ?? view.user_id,
        spaces: view.spaces,
        write_space: view.write_space ?? null,
        read_only: view.read_only ?? null,
        space: resolved.config.space,
        project_id: resolved.config.project_id,
    }, () => panel(`Connected as ${view.user_id}`, context.colors, {
        title: 'LongMemory auth', kind: 'success', width: context.terminal_width,
        rows: [
            ['Mode', 'remote'],
            ['Server', resolved.config.server_url],
            ['User', view.user_id],
            ['Spaces', view.spaces.map((space) => space.id).join(', ')],
            ['Space', resolved.config.space ?? 'read default'],
            ['Config', config_path],
        ],
    }));
};
