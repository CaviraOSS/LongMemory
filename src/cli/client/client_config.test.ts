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
*  file  : src/cli/client/client_config.test.ts
*  usage : verifies the per-user client config and its resolution order
*/

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
    client_config_path,
    normalize_server_url,
    read_client_config,
    resolve_client_config,
    write_client_config,
} from './client_config.js';

const with_home = () => {
    const home = mkdtempSync(join(tmpdir(), 'longmemory-client-'));
    const env = { HOME: home, XDG_CONFIG_HOME: join(home, 'config') };
    return { home, env, path: client_config_path(env), cleanup: () => rmSync(home, { recursive: true, force: true }) };
};

test('uses XDG_CONFIG_HOME, then HOME, for the client config path', () => {
    const home = mkdtempSync(join(tmpdir(), 'longmemory-client-'));
    try {
        assert.equal(client_config_path({ HOME: home, XDG_CONFIG_HOME: '/tmp/xdg' }), '/tmp/xdg/longmemory/client.json');
        assert.equal(client_config_path({ HOME: home }), join(home, '.config', 'longmemory', 'client.json'));
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('writes 0600 and reads the same config back', () => {
    const fixture = with_home();
    try {
        write_client_config(fixture.path, {
            server_url: 'http://127.0.0.1:7331',
            token: 'lm_abcdefghijkl_secret',
            space: 'team:core',
            project_id: 'longmemory',
        });
        assert.equal(statSync(fixture.path).mode & 0o777, 0o600);
        assert.equal(statSync(join(fixture.home, 'config', 'longmemory')).mode & 0o777, 0o700);
        assert.deepEqual(read_client_config(fixture.path), {
            server_url: 'http://127.0.0.1:7331',
            token: 'lm_abcdefghijkl_secret',
            space: 'team:core',
            project_id: 'longmemory',
        });
    } finally {
        fixture.cleanup();
    }
});

test('rewriting a looser file re-applies 0600', () => {
    const fixture = with_home();
    try {
        write_client_config(fixture.path, {
            server_url: 'http://127.0.0.1:7331',
            token: 'lm_abcdefghijkl_secret',
            space: null,
            project_id: null,
        });
        chmodSync(fixture.path, 0o644);
        write_client_config(fixture.path, read_client_config(fixture.path));
        assert.equal(statSync(fixture.path).mode & 0o777, 0o600);
    } finally {
        fixture.cleanup();
    }
});

test('flags win over env, env wins over the file, and a partial pair fails', () => {
    const fixture = with_home();
    try {
        write_client_config(fixture.path, {
            server_url: 'http://file:7331',
            token: 'lm_file_secret',
            space: 'personal',
            project_id: 'file-project',
        });
        assert.deepEqual(resolve_client_config({}, fixture.env), {
            mode: 'remote',
            source: 'file',
            config: {
                server_url: 'http://file:7331',
                token: 'lm_file_secret',
                space: 'personal',
                project_id: 'file-project',
            },
            path: fixture.path,
        });

        const env = { ...fixture.env, LONGMEMORY_SERVER_URL: 'http://env:7331', LONGMEMORY_TOKEN: 'lm_env_secret' };
        const from_env = resolve_client_config({}, env);
        assert.equal(from_env.mode, 'remote');
        if (from_env.mode === 'remote') {
            assert.equal(from_env.source, 'env');
            assert.equal(from_env.config.server_url, 'http://env:7331');
            assert.equal(from_env.config.space, 'personal');
        }

        const token_file = join(fixture.home, 'token');
        writeFileSync(token_file, 'lm_flag_secret\n');
        const from_flags = resolve_client_config({ server: 'http://flag:7331', token_file }, env);
        assert.equal(from_flags.mode, 'remote');
        if (from_flags.mode === 'remote') {
            assert.equal(from_flags.source, 'flags');
            assert.equal(from_flags.config.server_url, 'http://flag:7331');
            assert.equal(from_flags.config.token, 'lm_flag_secret');
        }

        assert.throws(() => resolve_client_config({ server: 'http://flag:7331' }, fixture.env), /token-file/);
        assert.throws(() => resolve_client_config({ server: 'http://flag:7331' }, { ...fixture.env, LONGMEMORY_TOKEN: 'lm_env_secret' }), /token-file/);
    } finally {
        fixture.cleanup();
    }
});

test('falls back to local only when no remote source is present', () => {
    const fixture = with_home();
    try {
        assert.deepEqual(resolve_client_config({}, fixture.env), { mode: 'local' });
        assert.throws(() => resolve_client_config({}, { ...fixture.env, LONGMEMORY_SERVER_URL: 'http://env:7331' }), /LONGMEMORY_TOKEN/);
        assert.throws(() => resolve_client_config({}, { ...fixture.env, LONGMEMORY_TOKEN: 'lm_env_secret' }), /LONGMEMORY_SERVER_URL/);
    } finally {
        fixture.cleanup();
    }
});

test('rejects invalid config JSON, missing fields, and bad URLs', () => {
    const fixture = with_home();
    try {
        mkdirSync(dirname(fixture.path), { recursive: true, mode: 0o700 });
        writeFileSync(fixture.path, '{not json');
        assert.throws(() => read_client_config(fixture.path), /client_config_invalid/);
        writeFileSync(fixture.path, JSON.stringify({ server_url: 'http://127.0.0.1:7331' }));
        assert.throws(() => read_client_config(fixture.path), /token/);
        assert.equal(normalize_server_url('http://127.0.0.1:7331/'), 'http://127.0.0.1:7331');
        assert.equal(normalize_server_url('http://127.0.0.1:7331/mcp/'), 'http://127.0.0.1:7331');
        assert.throws(() => normalize_server_url('ftp://127.0.0.1:7331'), /http/);
        assert.throws(() => normalize_server_url('http://127.0.0.1:7331/?x=1'), /query/);
    } finally {
        fixture.cleanup();
    }
});
