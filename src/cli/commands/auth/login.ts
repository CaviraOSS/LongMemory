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
*  file  : src/cli/commands/auth/login.ts
*  usage : verifies a remote token and stores it in the client config
*/

import { client_config_path, normalize_server_url, read_token_file, write_client_config } from '../../client/client_config.js';
import { client_request_error, fetch_whoami } from '../../client/whoami.js';
import type { cli_command } from '../../context/cli_context.js';
import { command_flags, flag, has } from '../../context/cli_context.js';
import { cli_error, exit_codes } from '../../output/errors.js';
import { panel } from '../../output/panel.js';
import { emit } from '../../output/pretty.js';

const space_pattern = /^(personal|all|team:[a-z0-9][a-z0-9._-]{0,63})$/;

const read_stdin = () => new Promise<string>((resolve_text, reject) => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => { value += chunk; });
    process.stdin.once('end', () => resolve_text(value));
    process.stdin.once('error', reject);
});

const request_error = (error: client_request_error) => new cli_error(
    error.code,
    error.message,
    error.code === 'authentication_failed' ? exit_codes.permission : exit_codes.generic,
);

export const auth_login_command: cli_command = async (context) => {
    command_flags(context, ['server', 'token-file', 'stdin', 'space']);

    const server = flag(context, 'server') ?? context.env.LONGMEMORY_SERVER_URL?.trim();
    if (!server) {
        throw new cli_error('validation_error', '--server or LONGMEMORY_SERVER_URL is required', exit_codes.validation);
    }
    const server_url = normalize_server_url(server);

    const token_file = flag(context, 'token-file');
    const env_token = context.env.LONGMEMORY_TOKEN?.trim();
    const token = token_file ? read_token_file(token_file)
        : has(context, 'stdin') ? (await read_stdin()).trim()
        : env_token;
    if (!token) {
        throw new cli_error('validation_error', '--token-file, --stdin, or LONGMEMORY_TOKEN is required', exit_codes.validation);
    }

    const requested_space = flag(context, 'space') ?? context.env.LONGMEMORY_SPACE?.trim() ?? null;
    if (requested_space && !space_pattern.test(requested_space)) {
        throw new cli_error('validation_error', `invalid space: ${requested_space}`, exit_codes.validation);
    }
    // The config persists only an explicit --space; an env space scopes verification but is not copied.
    const persisted_space = flag(context, 'space') ?? null;
    const project_id = flag(context, 'project')?.trim() || null;
    const config_path = client_config_path(context.env);

    if (context.dry_run) {
        emit(context, {
            ok: true, command: 'auth:login', dry_run: true, server_url,
            space: persisted_space, verified_space: requested_space, config_path, verified: false,
        }, () => panel('Login configuration is valid; the token was not verified or stored.', context.colors, {
            title: 'Login preview', kind: 'warning', width: context.terminal_width,
            rows: [
                ['Server', server_url],
                ['Verified with', requested_space ?? 'read default'],
                ['Persisted space', persisted_space ?? 'read default'],
                ['Config', config_path],
            ],
        }));
        return;
    }

    let view;
    try {
        view = await fetch_whoami({ server_url, token });
    } catch (error) {
        if (error instanceof client_request_error) throw request_error(error);
        throw error;
    }

    if (requested_space?.startsWith('team:') && !view.spaces.some((space) => space.id === requested_space)) {
        throw new cli_error('space_forbidden', `no access to space: ${requested_space}`, exit_codes.validation);
    }

    write_client_config(config_path, { server_url, token, space: persisted_space, project_id });

    emit(context, {
        ok: true, command: 'auth:login', server_url,
        user_id: view.user_id,
        display_name: view.display_name ?? view.user_id,
        spaces: view.spaces,
        space: persisted_space,
        verified_space: requested_space,
        config_path,
    }, () => panel(`Logged in as ${view.user_id}`, context.colors, {
        title: 'Remote login', kind: 'success', width: context.terminal_width,
        rows: [
            ['Server', server_url],
            ['User', view.user_id],
            ['Spaces', view.spaces.map((space) => space.id).join(', ')],
            ['Persisted space', persisted_space ?? 'read default'],
            ...(requested_space !== persisted_space ? [['Verified with', requested_space ?? 'read default'] as [string, string]] : []),
            ['Config', config_path],
            ['Warning', 'the token is stored in this 0600 file'],
        ],
    }));
};
