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
*  file  : src/control/control_db.test.ts
*  usage : verifies token control database behavior
*/

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { control_db, type control_db_options } from './control_db.js';
import { control_error } from './errors.js';
import { create_token_value, parse_token } from './token.js';

const with_db = (options: control_db_options = {}) => {
    const directory = mkdtempSync(join(tmpdir(), 'longmemory-control-'));
    const db = new control_db(join(directory, 'control.db'), options);
    return { db, close: () => { db.close(); rmSync(directory, { recursive: true, force: true }); } };
};

test('creates users, teams, and memberships with per-space roles', () => {
    const store = with_db();
    const alice = store.db.create_user({ id: 'alice', display_name: 'Alice' });
    assert.equal(alice.personal_partition, 'alice');
    store.db.create_team({ id: 'core', name: 'Core' });
    store.db.add_member('core', 'alice', 'admin');
    assert.equal(store.db.membership('alice', 'core')?.role, 'admin');
    assert.deepEqual(store.db.list_memberships('alice').map((item) => [item.team_id, item.role]), [['core', 'admin']]);
    store.close();
});

test('keeps personal partitions unique and adopts default explicitly', () => {
    const store = with_db();
    store.db.create_user({ id: 'default', display_name: 'Default' });
    store.db.create_user({ id: 'alice', display_name: 'Alice' });
    assert.throws(() => store.db.set_personal_partition('alice', 'default'), (error: unknown) =>
        error instanceof control_error && error.code === 'conflict');
    store.db.set_personal_partition('alice', 'alice-legacy');
    assert.equal(store.db.get_user('alice')?.personal_partition, 'alice-legacy');
    store.close();
});

test('rejects personal partitions that could impersonate a team partition', () => {
    const store = with_db();
    store.db.create_user({ id: 'alice', display_name: 'Alice' });
    assert.throws(() => store.db.set_personal_partition('alice', 'team:core'), (error: unknown) =>
        error instanceof control_error && error.code === 'validation_error');
    assert.throws(() => store.db.create_user({ id: 'bob', personal_partition: 'team:core' }), (error: unknown) =>
        error instanceof control_error && error.code === 'validation_error');
    store.close();
});

test('creates a token once, stores only a hash, and verifies it', () => {
    const store = with_db();
    store.db.create_user({ id: 'alice', display_name: 'Alice' });
    const created = store.db.create_token({ user_id: 'alice', label: 'laptop' });
    assert.match(created.token, /^lm_[a-z2-7]{12}_[A-Za-z0-9_-]{43}$/);
    assert.equal(parse_token(created.token)?.id, created.id);
    const raw = store.db.raw<{ secret_hash: string }>('SELECT secret_hash FROM tokens WHERE id = ?', created.id);
    assert.ok(raw);
    assert.notEqual(raw.secret_hash, created.token);
    const identity = store.db.authenticate_token(created.token);
    assert.equal(identity.ok, true);
    if (identity.ok) assert.equal(identity.identity.user.id, 'alice');
    store.close();
});

test('rejects malformed default spaces as invalid and inaccessible ones as forbidden', () => {
    const store = with_db();
    store.db.create_user({ id: 'alice', display_name: 'Alice' });
    store.db.create_team({ id: 'core', name: 'Core' });
    assert.throws(() => store.db.create_token({ user_id: 'alice', label: 'bad', default_space: 'team:' }), (error: unknown) =>
        error instanceof control_error && error.code === 'invalid_space' && error.status === 400);
    assert.throws(() => store.db.create_token({ user_id: 'alice', label: 'other', default_space: 'nonsense' }), (error: unknown) =>
        error instanceof control_error && error.code === 'invalid_space');
    assert.throws(() => store.db.create_token({ user_id: 'alice', label: 'missing', default_space: 'team:core' }), (error: unknown) =>
        error instanceof control_error && error.code === 'space_forbidden');
    store.close();
});

test('rejects expired, revoked, and disabled-user tokens', () => {
    const store = with_db();
    store.db.create_user({ id: 'alice', display_name: 'Alice' });
    const expired = store.db.create_token({ user_id: 'alice', label: 'old', expires_at: 100 });
    const expired_result = store.db.authenticate_token(expired.token, 200);
    assert.equal(expired_result.ok, false);
    if (!expired_result.ok) assert.equal(expired_result.code, 'token_expired');
    const revoked = store.db.create_token({ user_id: 'alice', label: 'off' });
    store.db.revoke_token(revoked.id);
    const revoked_result = store.db.authenticate_token(revoked.token);
    assert.equal(revoked_result.ok, false);
    if (!revoked_result.ok) assert.equal(revoked_result.code, 'token_revoked');
    const live = store.db.create_token({ user_id: 'alice', label: 'live' });
    store.db.disable_user('alice');
    const disabled_result = store.db.authenticate_token(live.token);
    assert.equal(disabled_result.ok, false);
    if (!disabled_result.ok) assert.equal(disabled_result.code, 'unauthorized');
    store.close();
});

test('uses the injected clock for expiry when no timestamp is passed', () => {
    const store = with_db({ now: () => 1000 });
    store.db.create_user({ id: 'alice', display_name: 'Alice' });
    const fresh = store.db.create_token({ user_id: 'alice', label: 'fresh', expires_at: 5000 });
    const valid = store.db.authenticate_token(fresh.token);
    assert.equal(valid.ok, true);
    if (valid.ok) assert.equal(valid.identity.token.last_used_at, 1000);
    const stale = store.db.create_token({ user_id: 'alice', label: 'stale', expires_at: 500 });
    const expired = store.db.authenticate_token(stale.token);
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.code, 'token_expired');
    store.close();
});

test('token modules produce a parseable id and fixed-length hash', () => {
    const value = create_token_value();
    assert.equal(parse_token(value.token)?.secret.length, 43);
    assert.equal(value.secret_hash.length, 64);
    assert.equal(parse_token('lm_bad'), null);
});
