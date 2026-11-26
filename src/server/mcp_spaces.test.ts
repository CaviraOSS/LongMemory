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
*  file  : src/server/mcp_spaces.test.ts
*  usage : end-to-end MCP client checks for token identities and spaces
*/

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { control_db } from '../control/control_db.js';
import { create_long_memory_app, type long_memory_app } from './app.js';
import type { server_config } from './config.js';

type tokens = { alice: string; bob_live: string };

const test_config = (overrides: Partial<server_config> = {}): server_config => ({
    host: '127.0.0.1',
    port: 0,
    api_key: null,
    control_db_path: null,
    mcp_http: false,
    max_payload_size: 1_048_576,
    rate_limit: { enabled: false, window_ms: 60_000, max_requests: 100 },
    log_auth: false,
    telemetry: false,
    allowed_origins: [],
    max_active_requests: 64,
    embedding: null,
    memory: { store: 'sqlite', db_path: ':memory:', tenant_id: 'tenant-1', user_id: 'default', max_context_tokens: 2048 },
    ...overrides,
});

const seed_control = (path: string): tokens => {
    const db = new control_db(path);
    db.create_user({ id: 'alice', display_name: 'Alice' });
    db.create_user({ id: 'bob', display_name: 'Bob' });
    db.create_team({ id: 'core', name: 'Core' });
    db.create_team({ id: 'readers', name: 'Readers' });
    db.add_member('core', 'alice', 'member');
    db.add_member('core', 'bob', 'member');
    db.add_member('readers', 'alice', 'viewer');
    const alice = db.create_token({ user_id: 'alice', label: 'alice' });
    const bob = db.create_token({ user_id: 'bob', label: 'bob' });
    db.close();
    return { alice: alice.token, bob_live: bob.token };
};

const listen = (server: Server): Promise<string> => new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
});

const fixture = async () => {
    const directory = mkdtempSync(join(tmpdir(), 'longmemory-mcp-spaces-'));
    const control_path = join(directory, 'control.db');
    const tokens = seed_control(control_path);
    const app: long_memory_app = create_long_memory_app({
        config: test_config({
            control_db_path: control_path,
            mcp_http: true,
            memory: { store: 'sqlite', db_path: join(directory, 'memory.db'), tenant_id: 'tenant-1', user_id: 'default', max_context_tokens: 2048 },
        }),
    });
    const server = createServer(app.handler);
    const base = await listen(server);
    return {
        app, server, base, tokens, control_path,
        close: async () => {
            await new Promise<void>((resolve) => server.close(() => resolve()));
            await app.close();
            rmSync(directory, { recursive: true, force: true });
        },
    };
};

const connect = async (base: string, token: string) => {
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: 'longmemory-test', version: '0.0.0' });
    await client.connect(transport);
    return client;
};

const body = (result: Awaited<ReturnType<Client['callTool']>>) => {
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content.find((item): item is { type: 'text'; text: string } => item.type === 'text');
    assert.ok(text, 'tool result must contain text content');
    return JSON.parse(text.text);
};

test('MCP clients resolve token identities and scope every operation to spaces', async () => {
    const f = await fixture();
    const client = await connect(f.base, f.tokens.alice);
    try {
        const tools = await client.listTools();
        assert.ok(tools.tools.some((tool) => tool.name === 'longmemory_who_am_i'));
        assert.ok(tools.tools.some((tool) => tool.name === 'longmemory_ingest'));

        const who = body(await client.callTool({ name: 'longmemory_who_am_i', arguments: {} }));
        assert.equal(who.user_id, 'alice');
        assert.equal(who.auth_mode, 'token');
        assert.deepEqual(who.spaces.map((space: any) => space.id), ['personal', 'team:core', 'team:readers']);

        const personal = body(await client.callTool({
            name: 'longmemory_ingest',
            arguments: { text: 'alice personal deployment note', source: 'test' },
        }));
        assert.equal(personal.space, 'personal');

        const personal_project = body(await client.callTool({
            name: 'longmemory_ingest',
            arguments: { text: 'alice personal project deployment note', source: 'test', project_id: 'release' },
        }));
        assert.equal(personal_project.space, 'personal');
        assert.equal(personal_project.project_id, 'release');

        const team = body(await client.callTool({
            name: 'longmemory_ingest',
            arguments: { text: 'alice team project deployment note', source: 'test', project_id: 'release', space: 'team:core' },
        }));
        assert.equal(team.space, 'team:core');

        const merged = body(await client.callTool({
            name: 'longmemory_recall',
            arguments: { query: 'deployment note', mode: 'strict', space: 'all', project_id: 'release' },
        }));
        assert.equal(merged.space, 'all');
        assert.deepEqual(merged.spaces.map((space: any) => space.space), ['personal', 'team:core', 'team:readers']);
        assert.equal(merged.spaces.find((space: any) => space.space === 'personal').project_missing, false);
        assert.equal(merged.spaces.find((space: any) => space.space === 'team:core').project_missing, false);
        assert.equal(merged.spaces.find((space: any) => space.space === 'team:readers').project_missing, true);
        assert.ok(merged.items.some((item: any) => item.node.id === personal_project.memory_id));
        assert.ok(merged.items.some((item: any) => item.node.id === team.memory_id));

        const denied = await client.callTool({
            name: 'longmemory_ingest',
            arguments: { text: 'viewer note', source: 'test', space: 'team:readers' },
        });
        assert.equal(denied.isError, true);
        const denied_text = (denied.content as Array<{ type: string; text?: string }>).map((item) => item.text ?? '').join(' ');
        assert.match(denied_text, /not writable/);
    } finally {
        await client.close();
        await f.close();
    }
});

test('a revoking token fails on the next MCP call', async () => {
    const f = await fixture();
    const client = await connect(f.base, f.tokens.bob_live);
    try {
        const before = body(await client.callTool({ name: 'longmemory_who_am_i', arguments: {} }));
        assert.equal(before.user_id, 'bob');

        const db = new control_db(f.control_path);
        try {
            const token = db.list_tokens('bob')[0];
            db.revoke_token(token.id);
        } finally {
            db.close();
        }

        await assert.rejects(
            () => client.callTool({ name: 'longmemory_who_am_i', arguments: {} }),
            /401|unauthorized|token_revoked/i,
        );
    } finally {
        await client.close();
        await f.close();
    }
});
