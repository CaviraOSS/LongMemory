import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { run_cli_app } from '../cli_app.js';
import { client_config_path, write_client_config } from '../client/client_config.js';
import { create_cli_context } from '../context/cli_context.js';
import { parse_argv } from '../context/config_loader.js';
import { local_mcp_config } from './mcp.js';

const with_home = () => {
    const home = mkdtempSync(join(tmpdir(), 'longmemory-mcp-'));
    return { home, env: { HOME: home, XDG_CONFIG_HOME: join(home, 'config') }, cleanup: () => rmSync(home, { recursive: true, force: true }) };
};

const run = (args: string[], env: NodeJS.ProcessEnv) => {
    const output: string[] = [];
    const io = { stdout: (value: string) => output.push(value), stderr: (value: string) => output.push(value), terminal: false };
    const done = run_cli_app(args, env, io);
    return { output, done };
};

test('mcp --dry-run keeps the local plan without a client config', async () => {
    const fixture = with_home();
    try {
        const result = run(['mcp', '--dry-run', '--json', '--project', 'local-project'], fixture.env);
        assert.equal(await result.done, 0);
        const parsed = JSON.parse(result.output.join('\n'));
        assert.equal(parsed.transport, 'local');
        assert.equal(parsed.project_id, 'local-project');
        assert.equal(parsed.read_only, true);
    } finally {
        fixture.cleanup();
    }
});

test('mcp --dry-run reports a remote plan from the client config without the token', async () => {
    const fixture = with_home();
    try {
        write_client_config(client_config_path(fixture.env), {
            server_url: 'http://127.0.0.1:7331', token: 'lm_abcdefghijkl_secret', space: 'team:core', project_id: 'config-project',
        });
        const result = run(['mcp', '--dry-run', '--json'], fixture.env);
        assert.equal(await result.done, 0);
        const text = result.output.join('\n');
        assert.ok(!text.includes('lm_abcdefghijkl_secret'));
        const parsed = JSON.parse(text);
        assert.equal(parsed.transport, 'remote');
        assert.equal(parsed.server_url, 'http://127.0.0.1:7331');
        assert.equal(parsed.space, 'team:core');
        assert.equal(parsed.project_id, 'config-project');
        assert.equal('read_only' in parsed, false);
        assert.equal('db_path' in parsed, false);
    } finally {
        fixture.cleanup();
    }
});

test('mcp flags win over the client config and env', async () => {
    const fixture = with_home();
    try {
        write_client_config(client_config_path(fixture.env), {
            server_url: 'http://file:7331', token: 'lm_file_secret', space: 'personal', project_id: 'file-project',
        });
        const token_file = join(fixture.home, 'token');
        writeFileSync(token_file, 'lm_flag_secret\n');
        const result = run(['mcp', '--dry-run', '--json', '--server', 'http://flag:7331', '--token-file', token_file, '--space', 'all', '--project', 'flag-project'], {
            ...fixture.env, LONGMEMORY_SERVER_URL: 'http://env:7331', LONGMEMORY_TOKEN: 'lm_env_secret',
        });
        assert.equal(await result.done, 0);
        const parsed = JSON.parse(result.output.join('\n'));
        assert.equal(parsed.server_url, 'http://flag:7331');
        assert.equal(parsed.space, 'all');
        assert.equal(parsed.project_id, 'flag-project');
    } finally {
        fixture.cleanup();
    }
});

test('mcp fails when --server and --token-file are not paired', async () => {
    const fixture = with_home();
    try {
        const result = run(['mcp', '--dry-run', '--json', '--server', 'http://127.0.0.1:7331'], fixture.env);
        assert.equal(await result.done, 2);
        assert.match(result.output.join('\n'), /client_config_incomplete/);
    } finally {
        fixture.cleanup();
    }
});

test('mcp rejects --space without a remote configuration', async () => {
    const fixture = with_home();
    try {
        const result = run(['mcp', '--dry-run', '--json', '--space', 'team:core'], fixture.env);
        assert.equal(await result.done, 2);
        assert.match(result.output.join('\n'), /remote/);
    } finally {
        fixture.cleanup();
    }
});

test('mcp rejects --read-only with a remote configuration', async () => {
    const fixture = with_home();
    try {
        write_client_config(client_config_path(fixture.env), {
            server_url: 'http://127.0.0.1:7331', token: 'lm_abcdefghijkl_secret', space: null, project_id: null,
        });
        const result = run(['mcp', '--dry-run', '--json', '--read-only'], fixture.env);
        assert.equal(await result.done, 2);
        assert.match(result.output.join('\n'), /--read-only/);
    } finally {
        fixture.cleanup();
    }
});

test('mcp fails loudly on a corrupt client config', async () => {
    const fixture = with_home();
    try {
        const path = client_config_path(fixture.env);
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        writeFileSync(path, '{not json');
        const result = run(['mcp', '--dry-run', '--json'], fixture.env);
        assert.equal(await result.done, 2);
        const text = result.output.join('\n');
        assert.match(text, /client_config_invalid/);
        assert.ok(!text.includes('"transport":"local"'));
    } finally {
        fixture.cleanup();
    }
});

test('mcp exits 6 when the remote rejects the token and never prints it', async () => {
    const fixture = with_home();
    const server = createServer((request, response) => {
        response.statusCode = 401;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'unauthorized' }, id: null }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    try {
        write_client_config(client_config_path(fixture.env), {
            server_url: `http://127.0.0.1:${address.port}`, token: 'lm_abcdefghijkl_secret', space: null, project_id: null,
        });
        const result = run(['mcp', '--json'], fixture.env);
        assert.equal(await result.done, 6);
        const text = result.output.join('\n');
        assert.match(text, /authentication_failed/);
        assert.ok(!text.includes('lm_abcdefghijkl_secret'));
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fixture.cleanup();
    }
});

test('local MCP config carries the effective space into the runtime', () => {
    const context = create_cli_context(parse_argv(['mcp']), { HOME: '/tmp/longmemory-mcp-test', LONGMEMORY_SPACE: 'personal' }, { stdout: () => {}, stderr: () => {}, terminal: false });
    const scoped = local_mcp_config(context, 'personal');
    assert.equal(scoped.requested_space, 'personal');
    assert.equal(scoped.space_explicit, true);
    const unscoped = local_mcp_config(context, null);
    assert.equal(unscoped.requested_space, null);
    assert.equal(unscoped.space_explicit, false);
});
