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
*  file  : src/cli/commands/auth/control_commands.test.ts
*  usage : verifies the control-plane CLI commands
*/

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { control_db } from '../../../control/control_db.js';
import { createMemory } from '../../../core/create_memory.js';
import { run_cli_app } from '../../cli_app.js';

type fixture = { root: string; control: string; memory: string };

const make_fixture = (): fixture => {
    const root = mkdtempSync(join(tmpdir(), 'longmemory-control-cli-'));
    return { root, control: join(root, 'control.db'), memory: join(root, 'project.db') };
};

const run = async (f: fixture, args: string[]) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await run_cli_app([
        '--cwd', f.root,
        '--control-db', f.control,
        '--json',
        ...args,
    ], {}, {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value),
        terminal: false,
    });
    const out = stdout.join('\n');
    const err = stderr.join('\n');
    let body: any;
    try { body = JSON.parse(out || err); } catch { body = undefined; }
    return { code, stdout: out, stderr: err, body };
};

const seed_default_memory = async (path: string): Promise<void> => {
    const memory = createMemory({ store: 'sqlite', db_path: path, tenant_id: 'default', user_id: 'default' });
    try {
        await memory.ingest({ user_id: 'default', text: 'legacy deployment note', metadata: { source_type: 'test' } });
    } finally {
        await memory.close();
    }
};

const open_control = (path: string) => new control_db(path);

test('auth:init creates a user, prints one token, and reports the server env', async () => {
    const f = make_fixture();
    try {
        const result = await run(f, ['auth:init', '--user', 'alice', '--name', 'Alice', '--db', f.memory]);
        assert.equal(result.code, 0);
        assert.equal(result.body.ok, true);
        assert.equal(result.body.created, true);
        assert.equal(result.body.user.id, 'alice');
        assert.equal(result.body.user.display_name, 'Alice');
        assert.match(result.body.token, /^lm_[a-z2-7]{12}_[A-Za-z0-9_-]{43}$/);
        assert.ok(result.stdout.includes(`LONGMEMORY_CONTROL_DB=${f.control}`));

        const db = open_control(f.control);
        try {
            const auth = db.authenticate_token(result.body.token);
            assert.equal(auth.ok, true);
            assert.equal(db.list_users().length, 1);
            assert.equal(db.list_tokens('alice').length, 1);
        } finally {
            db.close();
        }
    } finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});

test('auth:init on an existing user reports created:false and never leaks a token', async () => {
    const f = make_fixture();
    try {
        const first = await run(f, ['auth:init', '--user', 'alice', '--db', f.memory]);
        assert.equal(first.code, 0);

        const second = await run(f, ['auth:init', '--user', 'alice', '--db', f.memory]);
        assert.equal(second.code, 0);
        assert.equal(second.body.created, false);
        assert.equal('token' in second.body, false);
        assert.equal(second.stdout.includes(first.body.token), false);

        const db = open_control(f.control);
        try {
            assert.equal(db.list_users().filter((user) => user.id === 'alice').length, 1);
            assert.equal(db.list_tokens('alice').length, 1);
        } finally {
            db.close();
        }
    } finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});

test('auth:init refuses to orphan existing default data without --adopt-default', async () => {
    const f = make_fixture();
    try {
        await seed_default_memory(f.memory);
        const result = await run(f, ['auth:init', '--user', 'alice', '--db', f.memory]);
        assert.equal(result.code, 2);
        assert.match(result.body.error.message, /--adopt-default/);
        assert.match(result.body.error.message, /--user default/);

        const db = open_control(f.control);
        try {
            assert.equal(db.get_user('alice'), null);
        } finally {
            db.close();
        }
    } finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});

test('auth:init --adopt-default binds the new user to the default partition', async () => {
    const f = make_fixture();
    try {
        await seed_default_memory(f.memory);
        const result = await run(f, ['auth:init', '--user', 'alice', '--adopt-default', '--db', f.memory]);
        assert.equal(result.code, 0);
        assert.equal(result.body.user.personal_partition, 'default');

        const db = open_control(f.control);
        try {
            assert.equal(db.get_user('alice')?.personal_partition, 'default');
        } finally {
            db.close();
        }
    } finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});

test('users, teams, and spaces commands manage a shared control plane', async () => {
    const f = make_fixture();
    try {
        assert.equal((await run(f, ['auth:init', '--user', 'alice', '--db', f.memory])).code, 0);
        assert.equal((await run(f, ['users:create', '--id', 'bob', '--name', 'Bob'])).code, 0);

        const users = await run(f, ['users:list']);
        assert.equal(users.code, 0);
        assert.deepEqual(users.body.users.map((user: any) => user.id), ['alice', 'bob']);

        const spaced_users = await run(f, ['users', 'list']);
        assert.equal(spaced_users.code, 0);
        assert.deepEqual(spaced_users.body.users.map((user: any) => user.id), ['alice', 'bob']);

        assert.equal((await run(f, ['teams:create', '--id', 'core', '--name', 'Core'])).code, 0);
        assert.equal((await run(f, ['teams', 'add', 'core', 'alice', '--role', 'viewer'])).code, 0);
        assert.equal((await run(f, ['teams:add', 'core', 'bob'])).code, 0);

        const spaces = await run(f, ['spaces:list', '--user', 'alice']);
        assert.equal(spaces.code, 0);
        assert.equal(spaces.body.user_id, 'alice');
        assert.deepEqual(spaces.body.spaces.map((space: any) => space.id), ['personal', 'team:core']);
        assert.equal(spaces.body.spaces.find((space: any) => space.id === 'team:core').role, 'viewer');
        assert.equal(spaces.body.spaces.find((space: any) => space.id === 'team:core').writable, false);

        const all_spaces = await run(f, ['spaces:list']);
        assert.equal(all_spaces.code, 0);
        assert.deepEqual(all_spaces.body.users.map((user: any) => user.user_id), ['alice', 'bob']);

        assert.equal((await run(f, ['teams:remove', 'core', 'bob'])).code, 0);
        assert.equal((await run(f, ['teams:disable', 'core'])).code, 0);
        assert.equal((await run(f, ['users:disable', 'bob'])).code, 0);

        const disabled = await run(f, ['spaces:list', '--user', 'bob']);
        assert.equal(disabled.code, 6);
        assert.equal(disabled.body.error.code, 'unauthorized');
    } finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});

test('tokens:create --write keeps the secret out of stdout and writes a 0600 file', async () => {
    const f = make_fixture();
    const token_path = join(f.root, 'token.txt');
    try {
        assert.equal((await run(f, ['auth:init', '--user', 'alice', '--db', f.memory])).code, 0);
        assert.equal((await run(f, ['users:create', '--id', 'bob'])).code, 0);

        const created = await run(f, ['tokens:create', '--user', 'bob', '--label', 'laptop', '--write', token_path]);
        assert.equal(created.code, 0);
        assert.equal(created.body.token_file, token_path);
        assert.equal('token' in created.body, false);
        assert.equal(created.stdout.includes(readFileSync(token_path, 'utf8').trim()), false);

        assert.equal(statSync(token_path).mode & 0o777, 0o600);
        const secret = readFileSync(token_path, 'utf8').trim();
        const db = open_control(f.control);
        try {
            const auth = db.authenticate_token(secret);
            assert.equal(auth.ok, true);
        } finally {
            db.close();
        }

        const listed = await run(f, ['tokens:list', '--user', 'bob']);
        assert.equal(listed.code, 0);
        assert.equal(listed.body.tokens.length, 1);
        assert.equal(listed.body.tokens[0].label, 'laptop');
        assert.equal('token' in listed.body.tokens[0], false);

        const revoked = await run(f, ['tokens:revoke', listed.body.tokens[0].id]);
        assert.equal(revoked.code, 0);
        assert.ok(revoked.body.token.revoked_at !== null);

        const rejected = open_control(f.control);
        try {
            const auth = rejected.authenticate_token(secret);
            assert.equal(auth.ok, false);
            assert.equal(auth.ok === false && auth.code, 'token_revoked');
        } finally {
            rejected.close();
        }
    } finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});
