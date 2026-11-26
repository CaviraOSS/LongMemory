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
*  file  : src/cli/client/whoami.ts
*  usage : verifies a bearer token against a remote whoami endpoint
*/

import { normalize_server_url } from './client_config.js';

export type whoami_space = { id: string; label?: string; role?: string; writable?: boolean };

export type whoami_view = {
    user_id: string;
    display_name?: string;
    tenant_id?: string;
    spaces: whoami_space[];
    write_space?: whoami_space | null;
    read_only?: boolean;
};

export class client_request_error extends Error {
    constructor(readonly code: 'authentication_failed' | 'server_unreachable' | 'server_error', message: string) {
        super(message);
        this.name = 'client_request_error';
    }
}

export type whoami_request = {
    server_url: string;
    token: string;
    fetch?: typeof fetch;
    timeout_ms?: number;
};

export async function fetch_whoami(input: whoami_request): Promise<whoami_view> {
    const url = `${normalize_server_url(input.server_url)}/v1/whoami`;
    let response: Response;
    try {
        response = await (input.fetch ?? fetch)(url, {
            headers: { authorization: `Bearer ${input.token}`, accept: 'application/json' },
            signal: AbortSignal.timeout(input.timeout_ms ?? 10_000),
        });
    } catch (error) {
        // Never surface request headers or the token in a transport error.
        throw new client_request_error('server_unreachable', `LongMemory server is unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (response.status === 401) {
        throw new client_request_error('authentication_failed', 'The server rejected the token');
    }
    if (!response.ok) {
        throw new client_request_error('server_error', `LongMemory server returned ${response.status}`);
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new client_request_error('server_error', 'LongMemory server returned invalid JSON');
    }
    const data = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).data
        : undefined;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new client_request_error('server_error', 'LongMemory server returned a malformed whoami response');
    }

    const record = data as Record<string, unknown>;
    if (typeof record.user_id !== 'string' || !record.user_id.trim() || !Array.isArray(record.spaces)) {
        throw new client_request_error('server_error', 'LongMemory server returned a malformed whoami response');
    }

    return {
        user_id: record.user_id,
        ...(typeof record.display_name === 'string' ? { display_name: record.display_name } : {}),
        ...(typeof record.tenant_id === 'string' ? { tenant_id: record.tenant_id } : {}),
        spaces: record.spaces as whoami_space[],
        ...(record.write_space === null || (record.write_space && typeof record.write_space === 'object')
            ? { write_space: record.write_space as whoami_space | null }
            : {}),
        ...(typeof record.read_only === 'boolean' ? { read_only: record.read_only } : {}),
    };
}
