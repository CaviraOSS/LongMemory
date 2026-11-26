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
*  file  : src/control/space_catalog.test.ts
*  usage : verifies space catalog partitions and per-space access
*/

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { control_db } from './control_db.js';
import { control_error } from './errors.js';
import { space_catalog, type catalog_identity } from './space_catalog.js';

const is_control_error = (code: control_error['code']) => (error: unknown): boolean =>
    error instanceof control_error && error.code === code;

const make_fixture = () => {
    const directory = mkdtempSync(join(tmpdir(), 'longmemory-space-catalog-'));
    const db = new control_db(join(directory, 'control.db'));
    db.create_user({ id: 'alice', display_name: 'Alice' });
    db.create_user({ id: 'bob', display_name: 'Bob' });
    db.create_team({ id: 'core', name: 'Core' });
    db.create_team({ id: 'readers', name: 'Readers' });
    db.add_member('core', 'alice', 'admin');
    db.add_member('readers', 'alice', 'viewer');
    const created = db.create_token({ user_id: 'alice', label: 'alice-test' });
    const catalog = new space_catalog({
        db_path: join(directory, 'memory.db'),
        tenant_id: 'default',
        control: db,
        memory: {},
    });
    const tokens = new Map([['alice', created.token]]);
    const identity = (user_id: string): catalog_identity => {
        let token = tokens.get(user_id);
        if (!token) {
            token = db.create_token({ user_id, label: `${user_id}-test` }).token;
            tokens.set(user_id, token);
        }
        const result = catalog.authenticate_token(token);
        if (!result.ok) throw new Error(`authentication failed: ${result.code}`);
        return result.identity;
    };
    return {
        db,
        catalog,
        token: created.token,
        identity,
        close: async () => {
            await catalog.close();
            db.close();
            rmSync(directory, { recursive: true, force: true });
        },
    };
};

test('lists personal first, then teams by id, with per-space roles', async () => {
    const fixture = make_fixture();
    const identity = fixture.identity('alice');
    assert.deepEqual(fixture.catalog.spaces(identity).map((space) => [space.id, space.role, space.writable]), [
        ['personal', 'owner', true],
        ['team:core', 'admin', true],
        ['team:readers', 'viewer', false],
    ]);
    assert.deepEqual(fixture.catalog.access_for(identity, fixture.catalog.space(identity, 'team:core')!).team_ids, ['core']);
    assert.deepEqual(fixture.catalog.access_for(identity, fixture.catalog.space(identity, 'personal')!).roles, []);
    await fixture.close();
});

test('reads default to all with more than one space and writes default to personal', async () => {
    const fixture = make_fixture();
    const identity = fixture.identity('alice');
    assert.equal(fixture.catalog.read_default(identity), 'all');
    assert.equal(fixture.catalog.write_default(identity).id, 'personal');
    assert.throws(() => fixture.catalog.resolve_requested(identity, 'all', 'write'), is_control_error('space_forbidden'));
    await fixture.close();
});

test('rejects an explicit write to a read-only space', async () => {
    const fixture = make_fixture();
    const identity = fixture.identity('alice');
    assert.throws(() => fixture.catalog.resolve_requested(identity, 'team:readers', 'write'), is_control_error('space_forbidden'));
    // write_default still resolves a viewer default so resources can read through it.
    assert.equal(fixture.catalog.write_default({ ...identity, default_space: 'team:readers' }).id, 'team:readers');
    assert.deepEqual(
        fixture.catalog.resolve_requested(identity, 'team:readers', 'read'),
        [fixture.catalog.space(identity, 'team:readers')],
    );
    await fixture.close();
});

test('personal and team partitions never share memory', async () => {
    const fixture = make_fixture();
    const identity = fixture.identity('alice');
    const personal = fixture.catalog.memory_for(fixture.catalog.space(identity, 'personal')!);
    const team = fixture.catalog.memory_for(fixture.catalog.space(identity, 'team:core')!);
    await personal.ingest({ user_id: 'alice', text: 'personal only', metadata: { source_type: 'test' } });
    const team_recall = await team.recall({ text: 'personal only', mode: 'historical' });
    assert.equal('timeline' in team_recall, true);
    if ('timeline' in team_recall) assert.equal(team_recall.timeline.entries.length, 0);
    await fixture.close();
});

test('a disabled team disappears from spaces and fails a stale default closed', async () => {
    const fixture = make_fixture();
    fixture.identity('alice');
    fixture.db.disable_team('core');
    const refreshed = fixture.catalog.authenticate_token(fixture.token);
    assert.equal(refreshed.ok, true);
    if (!refreshed.ok) return;
    assert.ok(!fixture.catalog.spaces(refreshed.identity).some((space) => space.id === 'team:core'));
    assert.throws(() => fixture.catalog.write_default({ ...refreshed.identity, default_space: 'team:core' }), is_control_error('space_forbidden'));
    await fixture.close();
});

test('rejects malformed and inaccessible spaces without falling back', async () => {
    const fixture = make_fixture();
    const identity = fixture.identity('bob');
    assert.equal(fixture.catalog.space(identity, 'team:core'), null);
    assert.throws(() => fixture.catalog.resolve_requested(identity, 'team:core', 'read'), is_control_error('space_forbidden'));
    assert.throws(() => fixture.catalog.resolve_requested(identity, 'team:', 'read'), is_control_error('invalid_space'));
    await fixture.close();
});

test('legacy mode exposes one personal space and keeps the server read-only flag', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'longmemory-space-catalog-legacy-'));
    const config = {
        db_path: join(directory, 'memory.db'),
        tenant_id: 'default',
        readonly: true,
        control: null,
        memory: {},
        legacy: { user_id: 'default', team_ids: ['core', 'core'] },
    };
    const catalog = new space_catalog(config);
    const identity = catalog.legacy_identity();
    assert.deepEqual(catalog.spaces(identity).map((space) => [space.id, space.role, space.writable]), [
        ['personal', 'owner', false],
        ['team:core', 'member', false],
    ]);
    assert.equal(catalog.read_default(identity), 'all');
    assert.equal(catalog.access_for(identity, catalog.space(identity, 'team:core')!).read_only, true);
    assert.deepEqual(catalog.authenticate_token('lm_aaaaaaaaaaaa_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), {
        ok: false,
        code: 'unauthorized',
    });
    await catalog.close();
    // A colon in the legacy user id would let the personal partition impersonate a team partition.
    assert.throws(() => new space_catalog({ ...config, legacy: { user_id: 'team:core' } }), is_control_error('validation_error'));
    rmSync(directory, { recursive: true, force: true });
});
