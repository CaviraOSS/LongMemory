/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/____/_/   \__, /
*                      /____/                                 /____/
*
*  cavira oss (c) 2026  -  nullure (c) 2026
*  ----------------------------------------------------------
*  file  : src/cli/commands/mcp.ts
*  usage : runs the local MCP server or proxies stdio to a remote server
*/


import { resolve_client_config } from '../client/client_config.js';
import { run_remote_mcp_proxy, remote_proxy_error, resolve_proxy_project_id } from '../../mcp/transports/remote_proxy.js';
import { run_mcp_stdio } from '../../mcp/transports/stdio.js';
import type { cli_command, cli_context } from '../context/cli_context.js';
import { command_flags, flag, has } from '../context/cli_context.js';
import { cli_error, exit_codes } from '../output/errors.js';
import { emit } from '../output/pretty.js';
import { panel } from '../output/panel.js';

const space_pattern = /^(personal|all|team:[a-z0-9][a-z0-9._-]{0,63})$/;

export const local_mcp_config = (context: cli_context, space: string | null) => ({
    db_path: context.db_path,
    project_id: context.project_id,
    user_id: context.user_id,
    tenant_id: context.env.LONGMEMORY_TENANT_ID?.trim() || 'default',
    read_only: has(context, 'read-only'),
    audit_path: flag(context, 'audit') ?? `${context.db_path}.mcp-audit.jsonl`,
    env: context.env,
    requested_space: space,
    space_explicit: space !== null,
});

export const mcp_command: cli_command = async (context) => {
    command_flags(context, ['read-only', 'audit', 'server', 'token-file', 'space']);
    const remote = resolve_client_config({ server: flag(context, 'server'), token_file: flag(context, 'token-file') }, context.env);
    const explicit_space = flag(context, 'space')?.trim() || null;
    const space = explicit_space
        ?? context.env.LONGMEMORY_SPACE?.trim()
        ?? (remote.mode === 'remote' ? remote.config.space : null);
    if (space && !space_pattern.test(space)) {
        throw new cli_error('validation_error', `invalid space: ${space}`, exit_codes.validation);
    }
    if (remote.mode === 'local' && explicit_space) {
        throw new cli_error('validation_error', '--space requires a remote server configuration', exit_codes.validation);
    }
    if (remote.mode === 'remote') {
        // The remote server enforces permissions from the token; silently accepting these
        // local-only flags would let a host believe it is read-only when it is not.
        if (has(context, 'read-only')) {
            throw new cli_error('validation_error', '--read-only is not supported with a remote server; scope the token instead', exit_codes.validation);
        }
        if (flag(context, 'audit') !== undefined) {
            throw new cli_error('validation_error', '--audit is not supported with a remote server; the server owns its audit log', exit_codes.validation);
        }
    }
    const project_id = remote.mode === 'remote'
        ? resolve_proxy_project_id({ flag_project_id: flag(context, 'project'), env: context.env, config_project_id: remote.config.project_id, cwd: context.cwd })
        : context.project_id;
    const transport = remote.mode === 'remote' ? 'remote' : 'local';

    if (context.dry_run) {
        const result = remote.mode === 'remote'
            ? { ok: true, command: 'mcp', dry_run: true, transport, server_url: remote.config.server_url, space, project_id, user_id: context.user_id }
            : { ok: true, command: 'mcp', dry_run: true, transport, space, db_path: context.db_path, project_id, user_id: context.user_id, read_only: true };
        const rows: Array<[string, unknown]> = [
            ...(remote.mode === 'remote'
                ? [['Server', remote.config.server_url] as [string, unknown], ['Permissions', 'server-defined'] as [string, unknown]]
                : [['Database', context.db_path] as [string, unknown], ['Mode', 'read-only preview'] as [string, unknown]]),
            ['Transport', transport],
            ['Space', space ?? 'read default'],
            ['Project', project_id],
            ['User', context.user_id],
        ];
        emit(context, result, () => panel(`MCP configuration is valid (${transport}); stdio transport was not started.`, context.colors, {
            title: 'MCP preview', kind: 'warning', width: context.terminal_width,
            rows,
        }));
        return;
    }

    if (remote.mode === 'remote') {
        try {
            await run_remote_mcp_proxy({ server_url: remote.config.server_url, token: remote.config.token, space, project_id, cwd: context.cwd });
        } catch (error) {
            if (error instanceof remote_proxy_error) {
                throw new cli_error(
                    error.code,
                    error.message,
                    error.code === 'authentication_failed' ? exit_codes.permission : exit_codes.generic,
                );
            }
            throw error;
        }
        return;
    }

    await run_mcp_stdio(local_mcp_config(context, space));
};
