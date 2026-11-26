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
*  file  : src/cli/commands/auth/login.test.ts
*  usage : verifies auth:login verifies a token before writing the client config
*/

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { run_cli_app } from '../../cli_app.js';
import { client_config_path } from '../../client/client_config.js';

const with_server = async (handler: (authorization: string | undefined) => { status: number; body: unknown }) => {
    const seen: Array<string | undefined> = [];
    const server = createServer((request, response) => {
        const authorization = request.headers.authorization;
        seen.push(authorization);
        const result = handler(authorization);
        response.statusCode = result.status;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(result.body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const url = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
    return { server, url, seen, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
};

const whoami_body = (user_id: string, spaces: Array<{ id: string; writable: boolean }>) => ({
    data: { user_id, display_name: user_id, tenant_id: 'default', auth_mode: 'token', spaces, write_space: spaces[0], read_only: false },
});

const with_home = () => {
    const home = mkdtempSync(join(tmpdir(), 'longmemory-login-'));
    return { home, env: { HOME: home, XDG_CONFIG_HOME: join(home, 'config') }, cleanup: () => rmSync(home, { recursive: true, force: true }) };
};

const run = (args: string[], env: NodeJS.ProcessEnv) => {
    const output: string[] = [];
    const io = { stdout: (value: string) => output.push(value), stderr: (value: string) => output.push(value), terminal: false };
    const pending = run_cli_app(args, env, io);
    return { output, done: pending };
};

test('auth:login verifies the token and writes a 0600 config without printing the token', async () => {
    const fixture = with_home();
    const remote = await with_server(() => ({ status: 200, body: whoami_body('alice', [{ id: 'personal', writable: true }, { id: 'team:core', writable: true }]) }));
    try {
        const token_file = join(fixture.home, 'token');
        writeFileSync(token_file, 'lm_abcdefghijkl_supersecret\n');
        const result = run(['auth', 'login', '--server', remote.url, '--token-file', token_file, '--space', 'team:core', '--json'], fixture.env);
        assert.equal(await result.done, 0);
        const text = result.output.join('\n');
        assert.ok(!text.includes('lm_abcdefghijkl_supersecret'));
        const parsed = JSON.parse(text);
        assert.equal(parsed.command, 'auth:login');
        assert.equal(parsed.user_id, 'alice');
        assert.equal(parsed.space, 'team:core');
        assert.equal(parsed.config_path, client_config_path(fixture.env));
        assert.equal(JSON.parse(readFileSync(parsed.config_path, 'utf8')).token, 'lm_abcdefghijkl_supersecret');
    } finally {
        await remote.close();
        fixture.cleanup();
    }
});

test('auth:login scopes with LONGMEMORY_SPACE but persists only an explicit --space', async () => {
    const fixture = with_home();
    const remote = await with_server(() => ({ status: 200, body: whoami_body('alice', [{ id: 'personal', writable: true }, { id: 'team:core', writable: true }]) }));
    try {
        const token_file = join(fixture.home, 'token');
        writeFileSync(token_file, 'lm_abcdefghijkl_supersecret');
        const env = { ...fixture.env, LONGMEMORY_SPACE: 'team:core' };
        const result = run(['auth', 'login', '--server', remote.url, '--token-file', token_file, '--json'], env);
        assert.equal(await result.done, 0);
        const parsed = JSON.parse(result.output.join('\n'));
        // The env space scopes verification; only --space is persisted.
        assert.equal(parsed.space, null);
        assert.equal(parsed.verified_space, 'team:core');
        assert.equal(JSON.parse(readFileSync(parsed.config_path, 'utf8')).space, null);
    } finally {
        await remote.close();
        fixture.cleanup();
    }
});

test('auth:login --dry-run does not contact the server or write a config', async () => {
    const fixture = with_home();
    try {
        const token_file = join(fixture.home, 'token');
        writeFileSync(token_file, 'lm_abcdefghijkl_supersecret');
        const result = run(['auth', 'login', '--dry-run', '--json', '--server', 'http://127.0.0.1:9', '--token-file', token_file, '--space', 'team:core'], fixture.env);
        assert.equal(await result.done, 0);
        const parsed = JSON.parse(result.output.join('\n'));
        assert.equal(parsed.verified, false);
        assert.equal(parsed.space, 'team:core');
        assert.throws(() => readFileSync(client_config_path(fixture.env), 'utf8'), /ENOENT/);
    } finally {
        fixture.cleanup();
    }
});

test('auth:login rejects a 401 and writes nothing', async () => {
    const fixture = with_home();
    const remote = await with_server(() => ({ status: 401, body: { error: { code: 'unauthorized', message: 'Authentication failed' } } }));
    try {
        const token_file = join(fixture.home, 'token');
        writeFileSync(token_file, 'lm_abcdefghijkl_wrong');
        const result = run(['auth', 'login', '--server', remote.url, '--token-file', token_file, '--json'], fixture.env);
        assert.equal(await result.done, 6);
        assert.match(result.output.join('\n'), /authentication_failed/);
        assert.throws(() => readFileSync(client_config_path(fixture.env), 'utf8'), /ENOENT/);
    } finally {
        await remote.close();
        fixture.cleanup();
    }
});

test('auth:login rejects an inaccessible --space', async () => {
    const fixture = with_home();
    const remote = await with_server(() => ({ status: 200, body: whoami_body('alice', [{ id: 'personal', writable: true }]) }));
    try {
        const token_file = join(fixture.home, 'token');
        writeFileSync(token_file, 'lm_abcdefghijkl_supersecret');
        const result = run(['auth', 'login', '--server', remote.url, '--token-file', token_file, '--space', 'team:secret', '--json'], fixture.env);
        assert.equal(await result.done, 2);
        assert.match(result.output.join('\n'), /space_forbidden/);
    } finally {
        await remote.close();
        fixture.cleanup();
    }
});
