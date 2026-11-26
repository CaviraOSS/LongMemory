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
*  file  : src/cli/commands/auth/session.test.ts
*  usage : verifies auth:status and auth:logout against local and remote configs
*/

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { run_cli_app } from '../../cli_app.js';
import { client_config_path, write_client_config } from '../../client/client_config.js';

const with_home = () => {
    const home = mkdtempSync(join(tmpdir(), 'longmemory-auth-status-'));
    return { home, env: { HOME: home, XDG_CONFIG_HOME: join(home, 'config') }, cleanup: () => rmSync(home, { recursive: true, force: true }) };
};

const run = (args: string[], env: NodeJS.ProcessEnv) => {
    const output: string[] = [];
    const io = { stdout: (value: string) => output.push(value), stderr: (value: string) => output.push(value), terminal: false };
    const done = run_cli_app(args, env, io);
    return { output, done };
};

test('auth:status reports local mode when no config exists', async () => {
    const fixture = with_home();
    try {
        const result = run(['auth', 'status', '--json'], fixture.env);
        assert.equal(await result.done, 0);
        const parsed = JSON.parse(result.output.join('\n'));
        assert.equal(parsed.mode, 'local');
        assert.equal(parsed.configured, false);
    } finally {
        fixture.cleanup();
    }
});

test('auth:status verifies a remote config and reports the user without the token', async () => {
    const fixture = with_home();
    const server = createServer((request, response) => {
        assert.equal(request.headers.authorization, 'Bearer lm_abcdefghijkl_secret');
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ data: { user_id: 'alice', spaces: [{ id: 'personal', writable: true }], write_space: { id: 'personal' } } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${(address as { port: number }).port}`;
    try {
        write_client_config(client_config_path(fixture.env), { server_url: url, token: 'lm_abcdefghijkl_secret', space: null, project_id: null });
        const result = run(['auth', 'status', '--json'], fixture.env);
        assert.equal(await result.done, 0);
        const text = result.output.join('\n');
        assert.ok(!text.includes('lm_abcdefghijkl_secret'));
        const parsed = JSON.parse(text);
        assert.equal(parsed.mode, 'remote');
        assert.equal(parsed.user_id, 'alice');
        assert.equal(parsed.space, null);
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fixture.cleanup();
    }
});

test('auth:status fails with a permission exit when the token is rejected', async () => {
    const fixture = with_home();
    const server = createServer((request, response) => { response.statusCode = 401; response.end('{}'); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${(address as { port: number }).port}`;
    try {
        write_client_config(client_config_path(fixture.env), { server_url: url, token: 'lm_abcdefghijkl_secret', space: null, project_id: null });
        const result = run(['auth', 'status', '--json'], fixture.env);
        assert.equal(await result.done, 6);
        assert.match(result.output.join('\n'), /authentication_failed/);
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fixture.cleanup();
    }
});

test('auth:logout --dry-run reports the removal without deleting the config', async () => {
    const fixture = with_home();
    try {
        const path = client_config_path(fixture.env);
        write_client_config(path, { server_url: 'http://127.0.0.1:7331', token: 'lm_abcdefghijkl_secret', space: null, project_id: null });
        const result = run(['auth', 'logout', '--dry-run', '--json'], fixture.env);
        assert.equal(await result.done, 0);
        const parsed = JSON.parse(result.output.join('\n'));
        assert.equal(parsed.dry_run, true);
        assert.equal(parsed.removed, true);
        assert.equal(existsSync(path), true);
    } finally {
        fixture.cleanup();
    }
});

test('auth:logout removes the config and is idempotent', async () => {
    const fixture = with_home();
    try {
        const path = client_config_path(fixture.env);
        write_client_config(path, { server_url: 'http://127.0.0.1:7331', token: 'lm_abcdefghijkl_secret', space: null, project_id: null });
        const first = run(['auth', 'logout', '--json'], fixture.env);
        assert.equal(await first.done, 0);
        assert.equal(JSON.parse(first.output.join('\n')).removed, true);
        assert.equal(existsSync(path), false);
        const second = run(['auth', 'logout', '--json'], fixture.env);
        assert.equal(await second.done, 0);
        assert.equal(JSON.parse(second.output.join('\n')).removed, false);
    } finally {
        fixture.cleanup();
    }
});
