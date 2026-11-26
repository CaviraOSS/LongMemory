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
*  file  : src/cli/client/client_config.ts
*  usage : reads, writes, and resolves the per-user remote client config
*/

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cli_error, exit_codes } from '../output/errors.js';

export type client_config = {
    server_url: string;
    token: string;
    space: string | null;
    project_id: string | null;
};

export type resolved_client =
    | { mode: 'local' }
    | { mode: 'remote'; source: 'flags' | 'env' | 'file'; config: client_config; path: string };

export type client_flags = { server?: string; token_file?: string };

export function client_config_path(env: NodeJS.ProcessEnv = process.env): string {
    const xdg = env.XDG_CONFIG_HOME?.trim();
    const home = env.HOME?.trim();
    const base = xdg || (home ? join(home, '.config') : null);
    if (!base) {
        throw new cli_error('validation_error', 'HOME is not set; set HOME or XDG_CONFIG_HOME', exit_codes.validation);
    }
    return join(base, 'longmemory', 'client.json');
}

export function normalize_server_url(value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new cli_error('validation_error', `invalid server URL: ${value}`, exit_codes.validation);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new cli_error('validation_error', `server URL must use http or https: ${value}`, exit_codes.validation);
    }
    if (url.username || url.password) {
        throw new cli_error('validation_error', 'server URL must not contain credentials', exit_codes.validation);
    }
    if (url.search) {
        throw new cli_error('validation_error', 'server URL must not contain a query', exit_codes.validation);
    }
    if (url.hash) {
        throw new cli_error('validation_error', 'server URL must not contain a fragment', exit_codes.validation);
    }
    let path = url.pathname.replace(/\/$/, '');
    if (path.endsWith('/mcp')) path = path.slice(0, -'/mcp'.length);
    return `${url.origin}${path}`;
}

export function read_client_config(path: string): client_config {
    let raw: string;
    try {
        raw = readFileSync(path, 'utf8');
    } catch (error) {
        throw new cli_error('client_config_invalid', `client_config_invalid: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`, exit_codes.validation);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new cli_error('client_config_invalid', `client_config_invalid: ${path} is not valid JSON`, exit_codes.validation);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new cli_error('client_config_invalid', `client_config_invalid: ${path} must contain a JSON object`, exit_codes.validation);
    }

    const record = parsed as Record<string, unknown>;
    if (typeof record.server_url !== 'string' || !record.server_url.trim()) {
        throw new cli_error('client_config_invalid', `client_config_invalid: server_url is missing in ${path}`, exit_codes.validation);
    }
    if (typeof record.token !== 'string' || !record.token.trim()) {
        throw new cli_error('client_config_invalid', `client_config_invalid: token is missing in ${path}`, exit_codes.validation);
    }

    const optional = (key: 'space' | 'project_id'): string | null => {
        const value = record[key];
        if (value === undefined || value === null) return null;
        if (typeof value !== 'string') {
            throw new cli_error('client_config_invalid', `client_config_invalid: ${key} must be a string or null in ${path}`, exit_codes.validation);
        }
        return value;
    };

    return {
        server_url: normalize_server_url(record.server_url.trim()),
        token: record.token,
        space: optional('space'),
        project_id: optional('project_id'),
    };
}

export function write_client_config(path: string, config: client_config): void {
    const directory = dirname(path);
    const existed = existsSync(directory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    // mkdir mode is subject to umask, so an existing directory keeps its mode while a new one is tightened.
    if (!existed) chmodSync(directory, 0o700);
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    // writeFileSync only applies the mode when it creates the file; an existing file keeps its old mode.
    chmodSync(path, 0o600);
}

export function read_token_file(path: string): string {
    let raw: string;
    try {
        raw = readFileSync(path, 'utf8');
    } catch (error) {
        throw new cli_error('validation_error', `cannot read token file ${path}: ${error instanceof Error ? error.message : String(error)}`, exit_codes.validation);
    }
    const token = raw.trim();
    if (!token) {
        throw new cli_error('validation_error', `token file is empty: ${path}`, exit_codes.validation);
    }
    if (/[\s\u0000-\u001f\u007f]/.test(token)) {
        throw new cli_error('validation_error', `token file contains whitespace or control characters: ${path}`, exit_codes.validation);
    }
    return token;
}

export function resolve_client_config(input: client_flags = {}, env: NodeJS.ProcessEnv = process.env): resolved_client {
    const path = client_config_path(env);
    // An existing file is always parsed so a broken config cannot silently fall back to local SQLite.
    const file = existsSync(path) ? read_client_config(path) : null;

    if (input.server !== undefined || input.token_file !== undefined) {
        const server = input.server?.trim();
        const token_file = input.token_file?.trim();
        if (!server || !token_file) {
            throw new cli_error('client_config_incomplete', '--server and --token-file must be provided together', exit_codes.validation);
        }
        return {
            mode: 'remote',
            source: 'flags',
            config: {
                server_url: normalize_server_url(server),
                token: read_token_file(token_file),
                space: file?.space ?? null,
                project_id: file?.project_id ?? null,
            },
            path,
        };
    }

    const env_server = env.LONGMEMORY_SERVER_URL?.trim();
    const env_token = env.LONGMEMORY_TOKEN?.trim();
    if (env_server || env_token) {
        if (!env_server) {
            throw new cli_error('client_config_incomplete', 'LONGMEMORY_SERVER_URL and LONGMEMORY_TOKEN must be provided together; missing LONGMEMORY_SERVER_URL', exit_codes.validation);
        }
        if (!env_token) {
            throw new cli_error('client_config_incomplete', 'LONGMEMORY_SERVER_URL and LONGMEMORY_TOKEN must be provided together; missing LONGMEMORY_TOKEN', exit_codes.validation);
        }
        return {
            mode: 'remote',
            source: 'env',
            config: {
                server_url: normalize_server_url(env_server),
                token: env_token,
                space: file?.space ?? null,
                project_id: file?.project_id ?? null,
            },
            path,
        };
    }

    if (file) return { mode: 'remote', source: 'file', config: file, path };
    return { mode: 'local' };
}
