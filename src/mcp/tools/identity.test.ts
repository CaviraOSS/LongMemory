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
 *  file  : src/mcp/tools/identity.test.ts
 *  usage : verifies the identity and space discovery views
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { create_space_catalog } from '../../control/space_catalog.js';
import { control_db } from '../../control/control_db.js';
import { mcp_runtime } from '../runtime.js';
import { list_spaces_view, who_am_i_view } from './identity.js';

const make_fixture = () => {
    const directory = mkdtempSync(join(tmpdir(), 'longmemory-identity-'));
    const db = new control_db(join(directory, 'control.db'));
    db.create_user({ id: 'alice', display_name: 'Alice' });
    db.create_team({ id: 'core', name: 'Core' });
    db.add_member('core', 'alice', 'admin');
    const token = db.create_token({ user_id: 'alice', label: 'alice-identity' }).token;
    const catalog = create_space_catalog({
        db_path: join(directory, 'memory.db'),
        tenant_id: 'default',
        control: db,
        memory: {},
    });
    const result = catalog.authenticate_token(token);
    if (!result.ok) throw new Error(`authentication failed: ${result.code}`);
    return {
        catalog,
        identity: result.identity,
        close: async () => {
            await catalog.close();
            db.close();
            rmSync(directory, { recursive: true, force: true });
        },
    };
};

test('who_am_i reports the write default and every accessible space', () => {
    const fixture = make_fixture();
    const runtime = new mcp_runtime({ catalog: fixture.catalog, identity: fixture.identity, tenant_id: 'default' });
    const view = who_am_i_view(runtime);
    assert.equal(view.user_id, 'alice');
    assert.equal(view.display_name, 'Alice');
    assert.equal(view.tenant_id, 'default');
    assert.equal(view.auth_mode, 'token');
    assert.equal(view.read_only, false);
    assert.equal(view.tool_prefix, null);
    assert.equal(view.write_space.id, 'personal');
    assert.deepEqual(view.spaces.map((space) => space.id), ['personal', 'team:core']);
    assert.equal(view.spaces[1].label, 'Core');
    assert.equal(view.spaces[1].writable, true);
    fixture.close();
});

test('list_spaces returns the space list without identity fields', () => {
    const fixture = make_fixture();
    const runtime = new mcp_runtime({ catalog: fixture.catalog, identity: fixture.identity, tenant_id: 'default' });
    const view = list_spaces_view(runtime);
    assert.deepEqual(view.spaces.map((space) => space.id), ['personal', 'team:core']);
    assert.equal(view.spaces[0].kind, 'personal');
    assert.equal(view.spaces[1].kind, 'team');
    fixture.close();
});

test('who_am_i never exposes the token', () => {
    const fixture = make_fixture();
    const runtime = new mcp_runtime({ catalog: fixture.catalog, identity: fixture.identity, tenant_id: 'default' });
    const view = who_am_i_view(runtime);
    assert.ok(!Object.prototype.hasOwnProperty.call(view, 'token'), 'view must not contain a token field');
    assert.ok(!JSON.stringify(view).includes('"token":'), 'view must not serialize a token');
    fixture.close();
});