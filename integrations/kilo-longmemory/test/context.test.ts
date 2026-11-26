import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolve_context, session_context_cache, type process_result } from '../src/context.js';

const with_home = () => {
    const home = mkdtempSync(join(tmpdir(), 'longmemory-kilo-'));
    return {
        home,
        env: { HOME: home, XDG_CONFIG_HOME: join(home, 'config') },
        cleanup: () => rmSync(home, { recursive: true, force: true }),
    };
};

const write_client_config = (home: string, value: unknown) => {
    const dir = join(home, 'config', 'longmemory');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'client.json'), typeof value === 'string' ? value : JSON.stringify(value));
};

const json_response = (body: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
}) as Response;

const packet = { ok: true, schema: 'longmemory.project-context.v1', project_id: 'p', task: 't', open_tasks: [{ id: 'a<b' }] };

test('posts to the API URL with a bearer token and the space header', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const result = await resolve_context({
        task: '  ship the release  ',
        cwd: '/work/p',
        environment: { LONGMEMORY_API_URL: 'https://memory.test/', LONGMEMORY_TOKEN: 'lm_token', LONGMEMORY_SPACE: 'team:core', LONGMEMORY_PROJECT_ID: 'proj' },
        token_budget: 512,
        fetch: async (url, init) => { calls.push({ url: String(url), init: init as RequestInit }); return json_response({ data: packet }); },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://memory.test/v1/project/context');
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.authorization, 'Bearer lm_token');
    assert.equal(headers['x-longmemory-space'], 'team:core');
    assert.equal(headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
        task: 'ship the release',
        project_id: 'proj',
        agent: 'kilo',
        framework: 'kilo',
        token_budget: 512,
    });
    assert.match(result ?? '', /^<longmemory-context>\n\[LongMemory evidence/);
    assert.match(result ?? '', /a\\u003cb/);
    assert.equal((result ?? '').includes('a<b'), false);
});

test('uses LONGMEMORY_API_KEY, SERVER_URL + TOKEN, and the client config in order', async () => {
    const seen: string[] = [];
    const fetch_ok = async (url: Parameters<typeof fetch>[0]) => {
        seen.push(String(url));
        return json_response({ data: packet });
    };
    await resolve_context({ task: 't', cwd: '/p', environment: { LONGMEMORY_API_URL: 'https://api.test', LONGMEMORY_API_KEY: 'legacy' }, fetch: fetch_ok });
    assert.deepEqual(seen, ['https://api.test/v1/project/context']);

    seen.length = 0;
    const fixture = with_home();
    try {
        await resolve_context({ task: 't', cwd: '/p', environment: { ...fixture.env, LONGMEMORY_SERVER_URL: 'https://server.test/mcp', LONGMEMORY_TOKEN: 'lm_x' }, fetch: fetch_ok });
        assert.deepEqual(seen, ['https://server.test/v1/project/context']);

        write_client_config(fixture.home, { server_url: 'https://file.test', token: 'lm_file', space: 'personal', project_id: 'file-project' });
        seen.length = 0;
        await resolve_context({ task: 't', cwd: '/p', environment: fixture.env, fetch: fetch_ok });
        assert.deepEqual(seen, ['https://file.test/v1/project/context']);
    } finally {
        fixture.cleanup();
    }
});

test('reads the default ~/.config client config when XDG_CONFIG_HOME is unset', async () => {
    const fixture = with_home();
    try {
        const dir = join(fixture.home, '.config', 'longmemory');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'client.json'), JSON.stringify({
            server_url: 'https://file.test',
            token: 'lm_file',
            space: 'personal',
            project_id: 'file-project',
        }));
        const seen: string[] = [];
        const fetch_ok = async (url: Parameters<typeof fetch>[0]) => {
            seen.push(String(url));
            return json_response({ data: packet });
        };
        await resolve_context({ task: 't', cwd: '/p', environment: { HOME: fixture.home }, fetch: fetch_ok });
        assert.deepEqual(seen, ['https://file.test/v1/project/context']);
    } finally {
        fixture.cleanup();
    }
});

test('merges client-config space and project_id into the SERVER_URL source', async () => {
    const fixture = with_home();
    try {
        write_client_config(fixture.home, { server_url: 'https://file.test', token: 'lm_file', space: 'team:core', project_id: 'file-project' });
        const calls: Array<{ init: RequestInit }> = [];
        const fetch_ok = async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
            calls.push({ init: init as RequestInit });
            return json_response({ data: packet });
        };
        await resolve_context({
            task: 't',
            cwd: '/p',
            environment: { ...fixture.env, LONGMEMORY_SERVER_URL: 'https://server.test/mcp', LONGMEMORY_TOKEN: 'lm_x' },
            fetch: fetch_ok,
        });
        assert.equal(calls.length, 1);
        const headers = calls[0].init.headers as Record<string, string>;
        assert.equal(headers['x-longmemory-space'], 'team:core');
        assert.equal(JSON.parse(String(calls[0].init.body)).project_id, 'file-project');
    } finally {
        fixture.cleanup();
    }
});

test('lets environment space and project_id override the SERVER_URL client config', async () => {
    const fixture = with_home();
    try {
        write_client_config(fixture.home, { server_url: 'https://file.test', token: 'lm_file', space: 'team:core', project_id: 'file-project' });
        const calls: Array<{ init: RequestInit }> = [];
        const fetch_ok = async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
            calls.push({ init: init as RequestInit });
            return json_response({ data: packet });
        };
        await resolve_context({
            task: 't',
            cwd: '/p',
            environment: {
                ...fixture.env,
                LONGMEMORY_SERVER_URL: 'https://server.test',
                LONGMEMORY_TOKEN: 'lm_x',
                LONGMEMORY_SPACE: 'personal',
                LONGMEMORY_PROJECT_ID: 'env-project',
            },
            fetch: fetch_ok,
        });
        const headers = calls[0].init.headers as Record<string, string>;
        assert.equal(headers['x-longmemory-space'], 'personal');
        assert.equal(JSON.parse(String(calls[0].init.body)).project_id, 'env-project');
    } finally {
        fixture.cleanup();
    }
});

test('disables SERVER_URL injection when an existing client config is malformed', async () => {
    const fixture = with_home();
    try {
        write_client_config(fixture.home, '{not json');
        let fetch_called = false;
        let cli_called = false;
        const result = await resolve_context({
            task: 't',
            cwd: '/p',
            environment: { ...fixture.env, LONGMEMORY_SERVER_URL: 'https://server.test', LONGMEMORY_TOKEN: 'lm_x' },
            fetch: async () => { fetch_called = true; throw new Error('must not fetch'); },
            run: async () => { cli_called = true; return { code: 0, stdout: JSON.stringify(packet), stderr: '' }; },
        });
        assert.equal(result, null);
        assert.equal(fetch_called, false);
        assert.equal(cli_called, false);
    } finally {
        fixture.cleanup();
    }
});

test('disables injection when a token is configured without a server URL', async () => {
    const fixture = with_home();
    try {
        for (const token_key of ['LONGMEMORY_TOKEN', 'LONGMEMORY_API_KEY']) {
            let fetch_called = false;
            let cli_called = false;
            const result = await resolve_context({
                task: 't',
                cwd: '/p',
                environment: { ...fixture.env, [token_key]: 'lm_token' },
                fetch: async () => { fetch_called = true; return json_response({ data: packet }); },
                run: async () => { cli_called = true; return { code: 0, stdout: JSON.stringify(packet), stderr: '' }; },
            });
            assert.equal(result, null, token_key);
            assert.equal(fetch_called, false, token_key);
            assert.equal(cli_called, false, token_key);
        }
    } finally {
        fixture.cleanup();
    }
});

test('falls back to the CLI only when no remote source is configured', async () => {
    const fixture = with_home();
    try {
        const calls: string[][] = [];
        const run = async (command: string, args: string[]): Promise<process_result> => {
            calls.push([command, ...args]);
            return { code: 0, stdout: JSON.stringify(packet), stderr: '' };
        };
        const result = await resolve_context({ task: 'ship it', cwd: '/work/p', environment: fixture.env, run });
        assert.deepEqual(calls, [['longmemory', 'project', 'context', 'ship it', '--json', '--dry-run', '--token-budget', '2048']]);
        assert.match(result ?? '', /longmemory-data/);

        const custom = await resolve_context({ task: 't', cwd: '/p', environment: { ...fixture.env, LONGMEMORY_CLI: '/opt/longmemory' }, run });
        assert.deepEqual(calls[1], ['/opt/longmemory', 'project', 'context', 't', '--json', '--dry-run', '--token-budget', '2048']);
        assert.equal(custom !== null, true);
    } finally {
        fixture.cleanup();
    }
});

test('fails open on every error and never reads local memory after a remote failure', async () => {
    const fixture = with_home();
    try {
        let cli_called = false;
        const run = async (): Promise<process_result> => { cli_called = true; return { code: 1, stdout: '', stderr: 'boom' }; };
        const ok = { ...fixture.env };

        assert.equal(await resolve_context({ task: 't', cwd: '/p', environment: ok, run, fetch: async () => json_response({}, 500) }), null);
        assert.equal(cli_called, true);

        cli_called = false;
        const api_fail = { ...fixture.env, LONGMEMORY_API_URL: 'https://api.test', LONGMEMORY_TOKEN: 'lm_x' };
        assert.equal(await resolve_context({ task: 't', cwd: '/p', environment: api_fail, run, fetch: async () => json_response({}, 500) }), null);
        assert.equal(cli_called, false);

        assert.equal(await resolve_context({ task: 't', cwd: '/p', environment: api_fail, run, fetch: async () => { throw new Error('network'); } }), null);
        assert.equal(await resolve_context({ task: 't', cwd: '/p', environment: api_fail, run, fetch: async () => json_response({ data: 'nope' }) }), null);
        assert.equal(await resolve_context({ task: 't', cwd: '/p', environment: { ...fixture.env, LONGMEMORY_API_URL: 'https://api.test' }, run }), null);
        assert.equal(cli_called, false);

        write_client_config(fixture.home, '{not json');
        assert.equal(await resolve_context({ task: 't', cwd: '/p', environment: fixture.env, run }), null);
        assert.equal(cli_called, false);

        write_client_config(fixture.home, { server_url: 'https://file.test' });
        assert.equal(await resolve_context({ task: 't', cwd: '/p', environment: fixture.env, run }), null);
        assert.equal(cli_called, false);
    } finally {
        fixture.cleanup();
    }
});

test('rejects invalid budgets and blank tasks without calling anything', async () => {
    let called = false;
    const fetch = async () => { called = true; return json_response({ data: packet }); };
    const run = async () => { called = true; return { code: 0, stdout: '{}', stderr: '' }; };
    assert.equal(await resolve_context({ task: '   ', cwd: '/p', environment: { LONGMEMORY_API_URL: 'https://a.test', LONGMEMORY_TOKEN: 't' }, fetch, run }), null);
    assert.equal(await resolve_context({ task: 't', cwd: '/p', environment: { LONGMEMORY_API_URL: 'https://a.test', LONGMEMORY_TOKEN: 't' }, token_budget: 10, fetch, run }), null);
    assert.equal(await resolve_context({ task: 't', cwd: '/p', environment: { LONGMEMORY_API_URL: 'https://a.test', LONGMEMORY_TOKEN: 't' }, token_budget: 99.5, fetch, run }), null);
    assert.equal(called, false);
});

test('caps the task length before sending it upstream', async () => {
    const captured: { body: Record<string, unknown> | null } = { body: null };
    await resolve_context({
        task: 'x'.repeat(9000),
        cwd: '/p',
        environment: { LONGMEMORY_API_URL: 'https://a.test', LONGMEMORY_TOKEN: 't' },
        fetch: async (_url, init) => { captured.body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>; return json_response({ data: packet }); },
    });
    assert.equal(typeof captured.body?.task, 'string');
    assert.equal((captured.body?.task as string).length, 4000);
});

test('the session cache reuses one task and resolves a changed task once', async () => {
    const tasks: string[] = [];
    const cache = new session_context_cache(async (options) => { tasks.push(options.task); return options.task; });
    const options = { cwd: '/p', environment: {} };
    assert.equal(await cache.resolve('s1', { ...options, task: 'a' }), 'a');
    assert.equal(await cache.resolve('s1', { ...options, task: 'a' }), 'a');
    assert.deepEqual(tasks, ['a']);
    assert.equal(await cache.resolve('s1', { ...options, task: 'b' }), 'b');
    assert.deepEqual(tasks, ['a', 'b']);
    cache.invalidate('s1');
    assert.equal(await cache.resolve('s1', { ...options, task: 'b' }), 'b');
    assert.deepEqual(tasks, ['a', 'b', 'b']);
});

test('the session cache fails open when a resolver rejects', async () => {
    const cache = new session_context_cache(async () => { throw new Error('boom'); });
    assert.equal(await cache.resolve('s1', { task: 'a', cwd: '/p', environment: {} }), null);
    assert.equal(await cache.resolve('s1', { task: 'a', cwd: '/p', environment: {} }), null);
});
