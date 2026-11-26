/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/
 *
 *  cavira oss (c) 2026  -  nullure (c) 2026
 *  ----------------------------------------------------------
 *  file  : src/mcp/runtime.test.ts
 *  usage : verifies the runtime scopes reads by space and never writes from reads
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { create_space_catalog, type catalog_identity } from '../control/space_catalog.js';
import { control_db } from '../control/control_db.js';
import { control_error } from '../control/errors.js';
import { createMemory } from '../core/create_memory.js';
import { mcp_runtime } from './runtime.js';
import { create_tool_allowlist } from './security/tool_allowlist.js';

const is_control_error = (code: control_error['code']) =>
    (error: unknown): boolean => error instanceof control_error && error.code === code;

const make_catalog_fixture = () => {
    const directory = mkdtempSync(join(tmpdir(), 'longmemory-runtime-'));
    const db = new control_db(join(directory, 'control.db'));
    db.create_user({ id: 'alice', display_name: 'Alice' });
    db.create_user({ id: 'bob', display_name: 'Bob' });
    db.create_team({ id: 'core', name: 'Core' });
    db.create_team({ id: 'readers', name: 'Readers' });
    db.add_member('core', 'alice', 'admin');
    db.add_member('readers', 'alice', 'viewer');
    const alice_token = db.create_token({ user_id: 'alice', label: 'alice-runtime' }).token;
    const viewer_token = db.create_token({ user_id: 'alice', label: 'alice-viewer', default_space: 'team:readers' }).token;
    const bob_token = db.create_token({ user_id: 'bob', label: 'bob-runtime' }).token;
    const catalog = create_space_catalog({
        db_path: join(directory, 'memory.db'),
        tenant_id: 'default',
        control: db,
        memory: {},
    });
    const identity = (token: string): catalog_identity => {
        const result = catalog.authenticate_token(token);
        if (!result.ok) throw new Error(`authentication failed: ${result.code}`);
        return result.identity;
    };
    return {
        catalog,
        alice: identity(alice_token),
        viewer: identity(viewer_token),
        bob: identity(bob_token),
        close: async () => {
            await catalog.close();
            db.close();
            rmSync(directory, { recursive: true, force: true });
        },
    };
};

test('find_project does not create worlds and project(create:false) throws', async () => {
    const memory = createMemory({ store: 'sqlite', db_path: ':memory:' });
    const runtime = new mcp_runtime({ memory, tenant_id: 'default', user_id: 'alice' });

    assert.equal(runtime.resolve_project_id('current'), runtime.resolve_project_id());
    assert.notEqual(runtime.resolve_project_id('current'), 'current');
    assert.equal(runtime.resolve_project_id('release'), 'release');

    assert.equal(await runtime.find_project('missing'), null);
    const worlds_before = await runtime.memory.listWorlds();
    assert.equal(worlds_before.filter((world) => world.metadata.hierarchy === 'project').length, 0);

    await assert.rejects(runtime.project('missing', { create: false }), (error: unknown) => {
        assert.ok(error instanceof control_error);
        assert.equal(error.code, 'project_not_found');
        assert.match(error.message, /missing/);
        return true;
    });
    assert.equal((await runtime.memory.listWorlds()).length, worlds_before.length);

    const created = await runtime.project('release');
    const worlds = await runtime.memory.listWorlds();
    assert.ok(worlds.some((world) => world.metadata.project_id === 'release' && world.metadata.hierarchy === 'project'));
    assert.equal(await runtime.find_project('release'), created);
    assert.equal((await runtime.memory.listWorlds()).length, worlds.length);

    const readonly = new mcp_runtime({ memory, tenant_id: 'default', user_id: 'alice', read_only: true });
    const hydrated = await readonly.find_project('release');
    assert.equal(hydrated?.getProject('release').project_id, 'release');
    assert.equal(await readonly.find_project('missing'), null);
    await assert.rejects(readonly.project('release'), /read-only/);
    assert.equal((await runtime.memory.listWorlds()).length, worlds.length);
    await memory.close();
});

test('for_space scopes team ids and roles to that team', async () => {
    const fixture = make_catalog_fixture();
    const runtime = new mcp_runtime({ catalog: fixture.catalog, identity: fixture.alice, tenant_id: 'default' });

    assert.equal(runtime.space_id, 'personal');
    assert.equal(runtime.space_explicit, false);
    assert.deepEqual(runtime.spaces.map((space) => space.id), ['personal', 'team:core', 'team:readers']);
    assert.deepEqual(runtime.access.team_ids, []);
    assert.deepEqual(runtime.access.roles, []);
    assert.equal(runtime.access.user_id, 'alice');
    assert.equal(runtime.access.read_only, false);

    const core = runtime.for_space('team:core');
    assert.equal(core.space_id, 'team:core');
    assert.equal(core.space.label, 'Core');
    assert.equal(core.space_explicit, true);
    assert.equal(core.identity, fixture.alice);
    assert.equal(core.audit, runtime.audit);
    assert.equal(core.cwd, runtime.cwd);
    assert.deepEqual(core.access.team_ids, ['core']);
    assert.deepEqual(core.access.roles, ['admin']);
    assert.equal(core.access.read_only, false);
    assert.deepEqual(core.read_scopes(), [core.space]);
    assert.notEqual(core.memory, runtime.memory);
    assert.equal(core.memory, fixture.catalog.memory_for(core.space));
    await core.close();
    assert.ok(Array.isArray(await core.memory.listWorlds()));

    const readers = runtime.for_space('team:readers');
    assert.deepEqual(readers.access.team_ids, ['readers']);
    assert.deepEqual(readers.access.roles, ['viewer']);
    assert.equal(readers.access.read_only, true);
    assert.throws(() => runtime.write_scope('team:readers'), is_control_error('space_forbidden'));
    assert.equal(runtime.write_scope('team:core').id, 'team:core');

    assert.throws(() => runtime.for_space('team:unknown'), is_control_error('space_forbidden'));
    assert.equal(runtime.read_scopes(), 'all');
    const requested = runtime.read_scopes('team:core');
    assert.ok(Array.isArray(requested));
    assert.equal(requested[0].id, 'team:core');
    assert.throws(() => runtime.read_scopes('team:'), is_control_error('invalid_space'));
    assert.throws(() => runtime.read_scopes('team:unknown'), is_control_error('space_forbidden'));

    const bob = new mcp_runtime({ catalog: fixture.catalog, identity: fixture.bob, tenant_id: 'default' });
    assert.deepEqual(bob.spaces.map((space) => space.id), ['personal']);
    const bob_scopes = bob.read_scopes();
    assert.ok(Array.isArray(bob_scopes));
    assert.deepEqual(bob_scopes.map((space) => space.id), ['personal']);
    assert.throws(() => bob.for_space('team:core'), is_control_error('space_forbidden'));
    await fixture.close();
});

test('a read-only default space rejects implicit writes but allows explicit writable spaces', async () => {
    const fixture = make_catalog_fixture();
    const runtime = new mcp_runtime({ catalog: fixture.catalog, identity: fixture.viewer, tenant_id: 'default' });

    assert.equal(runtime.space.id, 'team:readers');
    assert.equal(runtime.access.read_only, true);
    assert.equal(runtime.write_scope('personal').id, 'personal');
    assert.equal(runtime.write_scope('team:core').id, 'team:core');
    assert.throws(() => runtime.write_scope(), is_control_error('space_forbidden'));
    assert.throws(() => runtime.write_scope('team:readers'), is_control_error('space_forbidden'));
    await fixture.close();
});

test('project cache is keyed by space and project', async () => {
    const fixture = make_catalog_fixture();
    const runtime = new mcp_runtime({ catalog: fixture.catalog, identity: fixture.alice, tenant_id: 'default' });
    const personal = await runtime.project('release');
    const core = runtime.for_space('team:core');
    const team = await core.project('release');

    assert.notEqual(personal, team);
    assert.equal(await runtime.project('release'), personal);
    assert.equal(await runtime.project('release', { create: false }), personal);
    assert.equal(await core.project('release'), team);
    assert.equal(await runtime.find_project('release'), personal);

    const personal_worlds = await runtime.memory.listWorlds();
    const team_worlds = await core.memory.listWorlds();
    const personal_root = personal_worlds.find((world) => world.metadata.project_id === 'release' && world.metadata.hierarchy === 'project');
    const team_root = team_worlds.find((world) => world.metadata.project_id === 'release' && world.metadata.hierarchy === 'project');
    assert.ok(personal_root);
    assert.ok(team_root);
    assert.notEqual(personal_root.id, team_root.id);

    const child = runtime.for_space('team:core');
    const team_world_count = team_worlds.length;
    assert.equal(await child.find_project('absent'), null);
    assert.equal((await core.memory.listWorlds()).length, team_world_count);
    assert.equal(await child.find_project('release'), team);
    assert.equal((await core.memory.listWorlds()).length, team_world_count);
    await fixture.close();
});

test('legacy construction still exposes one personal space and the same access', async () => {
    const memory = createMemory({ store: 'sqlite', db_path: ':memory:' });
    const runtime = new mcp_runtime({
        memory,
        tenant_id: 'tenant-1',
        user_id: 'alice',
        project_id: 'release',
        team_ids: ['core'],
        roles: ['admin'],
        agent_id: 'agent-1',
        framework: 'opencode',
        read_only: true,
        allowed_tools: ['longmemory_recall'],
    });

    assert.equal(runtime.space_id, 'personal');
    assert.equal(runtime.space_explicit, false);
    assert.deepEqual(runtime.space, {
        id: 'personal',
        kind: 'personal',
        label: 'alice',
        team_id: null,
        role: 'owner',
        partition: 'alice',
        writable: false,
    });
    assert.deepEqual(runtime.spaces.map((space) => space.id), ['personal']);
    assert.deepEqual(runtime.identity, {
        user_id: 'alice',
        display_name: 'alice',
        personal_partition: 'alice',
        teams: [],
        default_space: null,
        auth: 'legacy',
    });
    assert.equal(runtime.access.user_id, 'alice');
    assert.equal(runtime.access.project_id, 'release');
    assert.deepEqual(runtime.access, {
        user_id: 'alice',
        project_id: 'release',
        team_ids: ['core'],
        roles: ['admin'],
        agent_id: 'agent-1',
        framework: 'opencode',
        read_only: true,
        allowed_tools: create_tool_allowlist(['longmemory_recall']),
    });
    assert.equal(runtime.memory, memory);

    assert.deepEqual(runtime.read_scopes(), [runtime.space]);
    assert.equal(runtime.read_scopes('all'), 'all');
    const scoped = runtime.read_scopes('personal');
    assert.ok(Array.isArray(scoped));
    assert.equal(scoped[0].id, 'personal');
    assert.throws(() => runtime.write_scope(), is_control_error('space_forbidden'));
    assert.throws(() => runtime.write_scope('all'), is_control_error('space_forbidden'));
    assert.throws(() => runtime.read_scopes('team:core'), is_control_error('space_forbidden'));

    const writable = new mcp_runtime({ memory, tenant_id: 'tenant-1', user_id: 'alice' });
    assert.equal(writable.write_scope().id, 'personal');
    await writable.close();

    const child = runtime.for_space('personal');
    assert.equal(child.space_id, 'personal');
    assert.equal(child.memory, memory);
    assert.equal(await child.find_project('release'), null);
    assert.equal((await memory.listWorlds()).filter((world) => world.metadata.hierarchy === 'project').length, 0);

    await runtime.close();
    // The runtime did not own the supplied memory, so closing it must leave the store usable.
    assert.equal((await memory.listWorlds()).length, 1);
    await memory.close();
});
