/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ `/ __ `/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/
 *
 *  cavira oss (c) 2026  -  nullure (c) 2026
 *  ----------------------------------------------------------
 *  file  : src/server/control_mode.test.ts
 *  usage : verifies token authentication and space-aware HTTP routes
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { control_db } from '../control/control_db.js';
import { create_long_memory_app, type long_memory_app } from './app.js';
import type { server_config } from './config.js';

type tokens = { alice: string; bob: string; viewer: string; revoked: string };

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
    const viewer = db.create_token({ user_id: 'alice', label: 'viewer', default_space: 'team:readers' });
    const bob = db.create_token({ user_id: 'bob', label: 'bob' });
    const revoked = db.create_token({ user_id: 'bob', label: 'revoked' });
    db.revoke_token(revoked.id);
    db.close();
    return { alice: alice.token, bob: bob.token, viewer: viewer.token, revoked: revoked.token };
};

const listen = (server: Server): Promise<string> => new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
});

const control_fixture = async (overrides: Partial<server_config> = {}) => {
    const directory = mkdtempSync(join(tmpdir(), 'longmemory-control-mode-'));
    const control_path = join(directory, 'control.db');
    const memory_path = join(directory, 'memory.db');
    const tokens = seed_control(control_path);
    const app: long_memory_app = create_long_memory_app({
        config: test_config({
            control_db_path: control_path,
            memory: { store: 'sqlite', db_path: memory_path, tenant_id: 'tenant-1', user_id: 'default', max_context_tokens: 2048 },
            ...overrides,
        }),
    });
    const server = createServer(app.handler);
    const base = await listen(server);
    return {
        app, server, base, tokens,
        close: async () => {
            await new Promise<void>((resolve) => server.close(() => resolve()));
            await app.close();
            rmSync(directory, { recursive: true, force: true });
        },
    };
};

const call = async (base: string, path: string, options: RequestInit = {}) => {
    const response = await fetch(`${base}${path}`, options);
    const body = await response.json() as any;
    return { status: response.status, body, headers: response.headers };
};

const post = (base: string, path: string, body: unknown, token?: string) => call(base, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
});

const get = (base: string, path: string, token?: string, extra: Record<string, string> = {}) => call(base, path, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
});

const sse_json = (text: string): any => {
    const line = text.split('\n').find((entry) => entry.startsWith('data: '));
    return JSON.parse(line ? line.slice('data: '.length) : text);
};

test('control mode requires a bearer token and advertises the scheme', async () => {
    const f = await control_fixture();
    const response = await fetch(`${f.base}/v1/whoami`);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
    await f.close();
});

test('whoami returns the token identity and its spaces', async () => {
    const f = await control_fixture();
    const result = await get(f.base, '/v1/whoami', f.tokens.alice);
    assert.equal(result.status, 200);
    assert.equal(result.body.data.user_id, 'alice');
    assert.equal(result.body.data.auth_mode, 'token');
    assert.deepEqual(result.body.data.spaces.map((space: any) => space.id), ['personal', 'team:core', 'team:readers']);
    assert.equal(result.body.data.spaces.find((space: any) => space.id === 'team:readers').role, 'viewer');
    await f.close();
});

test('personal memory stays private and team memory is shared', async () => {
    const f = await control_fixture();
    const private_note = await post(f.base, '/v1/ingest', { text: 'alice deployment secret', space: 'personal' }, f.tokens.alice);
    assert.equal(private_note.status, 201);
    assert.equal(private_note.body.data.space, 'personal');

    const bob_personal = await post(f.base, '/v1/recall', { text: 'deployment secret', mode: 'strict', space: 'personal' }, f.tokens.bob);
    assert.equal(bob_personal.status, 200);
    assert.equal(bob_personal.body.data.items.length, 0);

    const team_note = await post(f.base, '/v1/ingest', { text: 'team deployment runbook', space: 'team:core' }, f.tokens.alice);
    assert.equal(team_note.status, 201);
    const alice_team = await post(f.base, '/v1/recall', { text: 'deployment runbook', mode: 'strict', space: 'team:core' }, f.tokens.alice);
    assert.equal(alice_team.status, 200);
    assert.ok(alice_team.body.data.items.length > 0);
    const bob_team = await post(f.base, '/v1/recall', { text: 'deployment runbook', mode: 'strict', space: 'team:core' }, f.tokens.bob);
    assert.equal(bob_team.status, 200);
    assert.ok(bob_team.body.data.items.length > 0);
    assert.equal(bob_team.body.data.space, 'team:core');
    assert.equal(bob_team.body.data.space_label, 'Core');
    await f.close();
});

test('a viewer cannot write and a mismatched user_id fails closed', async () => {
    const f = await control_fixture();
    const viewer = await post(f.base, '/v1/ingest', { text: 'viewer note', space: 'team:readers' }, f.tokens.alice);
    assert.equal(viewer.status, 403);
    assert.equal(viewer.body.error.code, 'space_forbidden');

    const mismatch = await post(f.base, '/v1/ingest', { text: 'bob note', user_id: 'bob', space: 'personal' }, f.tokens.alice);
    assert.equal(mismatch.status, 403);
    assert.equal(mismatch.body.error.code, 'identity_mismatch');
    await f.close();
});

test('a viewer default space rejects implicit writes but still resolves identity', async () => {
    const f = await control_fixture();
    const implicit = await post(f.base, '/v1/ingest', { text: 'viewer implicit write' }, f.tokens.viewer);
    assert.equal(implicit.status, 403);
    assert.equal(implicit.body.error.code, 'space_forbidden');

    const explicit_viewer = await post(f.base, '/v1/ingest', { text: 'viewer explicit write', space: 'team:readers' }, f.tokens.viewer);
    assert.equal(explicit_viewer.status, 403);
    assert.equal(explicit_viewer.body.error.code, 'space_forbidden');

    const personal = await post(f.base, '/v1/ingest', { text: 'viewer personal write', space: 'personal' }, f.tokens.viewer);
    assert.equal(personal.status, 201);
    assert.equal(personal.body.data.space, 'personal');

    const whoami = await get(f.base, '/v1/whoami', f.tokens.viewer);
    assert.equal(whoami.status, 200);
    assert.equal(whoami.body.data.write_space.id, 'team:readers');
    assert.equal(whoami.body.data.read_only, true);
    await f.close();
});

test('whoami with the all header still reports the write default', async () => {
    const f = await control_fixture();
    const result = await get(f.base, '/v1/whoami', f.tokens.alice, { 'x-longmemory-space': 'all' });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.write_space.id, 'personal');
    assert.deepEqual(result.body.data.spaces.map((space: any) => space.id), ['personal', 'team:core', 'team:readers']);
    await f.close();
});

test('a revoked token is rejected with token_revoked', async () => {
    const f = await control_fixture();
    const result = await get(f.base, '/v1/whoami', f.tokens.revoked);
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'token_revoked');
    await f.close();
});

test('space all merges and tags every accessible space', async () => {
    const f = await control_fixture();
    const personal = await post(f.base, '/v1/ingest', { text: 'deployment checklist personal', space: 'personal' }, f.tokens.alice);
    const team = await post(f.base, '/v1/ingest', { text: 'deployment checklist team', space: 'team:core' }, f.tokens.alice);
    assert.equal(personal.status, 201);
    assert.equal(team.status, 201);

    const merged = await post(f.base, '/v1/recall', { text: 'deployment checklist', mode: 'strict', space: 'all' }, f.tokens.alice);
    assert.equal(merged.status, 200);
    assert.equal(merged.body.data.space, 'all');
    assert.deepEqual(merged.body.data.spaces.map((space: any) => space.space), ['personal', 'team:core', 'team:readers']);
    const ids = merged.body.data.items.map((item: any) => item.node.id);
    assert.ok(ids.includes(personal.body.data.node.id));
    assert.ok(ids.includes(team.body.data.node.id));
    await f.close();
});

test('legacy mode keeps the API key check', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'longmemory-legacy-mode-'));
    const app = create_long_memory_app({
        config: test_config({
            api_key: 'legacy-key',
            memory: { store: 'sqlite', db_path: join(directory, 'memory.db'), tenant_id: 'tenant-1', user_id: 'default', max_context_tokens: 2048 },
        }),
    });
    const server = createServer(app.handler);
    const base = await listen(server);
    try {
        const unauthorized = await get(base, '/v1/stats');
        assert.equal(unauthorized.status, 401);
        const stats = await get(base, '/v1/stats', undefined, { 'x-api-key': 'legacy-key' });
        assert.equal(stats.status, 200);
        assert.equal(stats.body.data.closed, false);
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await app.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test('/mcp resolves the same token identity', async () => {
    const f = await control_fixture({ mcp_http: true });
    const response = await fetch(`${f.base}/mcp`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${f.tokens.alice}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'longmemory_who_am_i', arguments: {} } }),
    });
    assert.equal(response.status, 200);
    const payload = sse_json(await response.text());
    assert.equal(payload.error, undefined);
    const text = payload.result.content[0].text;
    const view = JSON.parse(text);
    assert.equal(view.user_id, 'alice');
    assert.equal(view.auth_mode, 'token');
    await f.close();
});
