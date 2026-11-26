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
*  file  : src/control/control_db.ts
*  usage : owns the control plane sqlite database
*/

import Database from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { control_error } from './errors.js';
import { create_token_value, parse_token, secret_matches } from './token.js';
import type {
    control_membership,
    control_role,
    control_space_record,
    control_team,
    control_token_record,
    control_user,
} from './types.js';

const schema_version = 1;
const id_pattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const roles: readonly control_role[] = ['viewer', 'member', 'admin'];
const dummy_hash = '0'.repeat(64);
const last_used_resolution_ms = 60_000;

const schema = `
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    personal_partition TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    disabled_at INTEGER
);

CREATE UNIQUE INDEX users_personal_partition_idx ON users(personal_partition);

CREATE TABLE teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    disabled_at INTEGER
);

CREATE TABLE team_members (
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('viewer', 'member', 'admin')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (team_id, user_id)
);

CREATE TABLE tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    secret_hash TEXT NOT NULL,
    default_space TEXT,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    expires_at INTEGER,
    revoked_at INTEGER
);

CREATE INDEX tokens_user_idx ON tokens(user_id);
`;

type control_token_row = control_token_record & { secret_hash: string };

export type control_db_options = {
    now?: () => number;
};

export type create_user_input = {
    id: string;
    display_name?: string;
    personal_partition?: string;
};

export type create_team_input = {
    id: string;
    name?: string;
};

export type create_token_input = {
    user_id: string;
    label: string;
    default_space?: string | null;
    expires_at?: number | null;
};

export type token_auth =
    | { ok: true; identity: { user: control_user; teams: control_membership[]; token: control_token_record } }
    | { ok: false; code: 'unauthorized' | 'token_expired' | 'token_revoked' };

const assert_id = (kind: 'user' | 'team', id: string): void => {
    if (!id_pattern.test(id)) throw new control_error('validation_error', `invalid ${kind} id: ${id}`);
};

// Personal partitions and team partitions share the (tenant_id, user_id) key space:
// a partition containing ':' could shadow `team:<id>`, so it must match the id pattern.
const assert_partition = (partition: string): void => {
    if (!id_pattern.test(partition)) {
        throw new control_error('validation_error', `invalid personal partition: ${partition}`);
    }
};

const assert_role = (role: string): control_role => {
    if (!roles.includes(role as control_role)) {
        throw new control_error('validation_error', `invalid role: ${role}`);
    }
    return role as control_role;
};

const is_constraint = (error: unknown): boolean =>
    error instanceof Error && String((error as { code?: unknown }).code ?? '').startsWith('SQLITE_CONSTRAINT');

const to_token_record = (row: control_token_row): control_token_record => ({
    id: row.id,
    user_id: row.user_id,
    label: row.label,
    default_space: row.default_space,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
});

const token_columns =
    'id, user_id, label, default_space, created_at, last_used_at, expires_at, revoked_at';
const user_columns = 'id, display_name, personal_partition, created_at, disabled_at';
const team_columns = 'id, name, created_at, disabled_at';

export class control_db {
    private readonly database: Database.Database;
    private readonly path: string;
    private readonly now: () => number;

    constructor(path = ':memory:', options: control_db_options = {}) {
        this.path = path;
        this.now = options.now ?? (() => Date.now());
        // Newly created directories get 0700; a pre-existing parent is left alone because it may be
        // shared (e.g. /tmp), and the 0600 database file is what protects its contents.
        if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        this.database = new Database(path);
        try {
            this.database.pragma('foreign_keys = ON');
            this.database.pragma('busy_timeout = 5000');
            if (path !== ':memory:') {
                this.database.pragma('journal_mode = WAL');
                this.secure_files();
            }
            this.apply_schema();
            this.secure_files();
        } catch (error) {
            this.database.close();
            throw error;
        }
    }

    raw<T>(sql: string, ...params: unknown[]): T | undefined {
        return this.database.prepare(sql).get(...params) as T | undefined;
    }

    create_user(input: create_user_input): control_user {
        assert_id('user', input.id);
        const display_name = input.display_name?.trim() || input.id;
        const personal_partition = input.personal_partition?.trim() || input.id;
        assert_partition(personal_partition);
        if (this.get_user(input.id)) throw new control_error('conflict', `user already exists: ${input.id}`);
        if (this.user_for_partition(personal_partition)) {
            throw new control_error('conflict', `personal partition is already claimed: ${personal_partition}`);
        }
        try {
            this.database
                .prepare(
                    'INSERT INTO users (id, display_name, personal_partition, created_at, disabled_at) ' +
                        'VALUES (?, ?, ?, ?, NULL)',
                )
                .run(input.id, display_name, personal_partition, this.now());
        } catch (error) {
            if (is_constraint(error)) throw new control_error('conflict', `user already exists: ${input.id}`);
            throw error;
        }
        return this.require_user(input.id);
    }

    get_user(id: string): control_user | null {
        return this.raw<control_user>(
            `SELECT ${user_columns} FROM users WHERE id = ?`,
            id,
        ) ?? null;
    }

    list_users(): control_user[] {
        return this.database
            .prepare(`SELECT ${user_columns} FROM users ORDER BY id`)
            .all() as control_user[];
    }

    disable_user(id: string): control_user {
        const user = this.require_user(id);
        if (user.disabled_at === null) {
            this.database.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(this.now(), id);
        }
        return this.require_user(id);
    }

    set_personal_partition(user_id: string, personal_partition: string): control_user {
        const user = this.require_user(user_id);
        const partition = personal_partition.trim();
        if (!partition) throw new control_error('validation_error', 'personal partition must not be empty');
        assert_partition(partition);
        const owner = this.user_for_partition(partition);
        if (owner && owner.id !== user_id) {
            throw new control_error('conflict', `personal partition is already claimed: ${partition}`);
        }
        if (user.personal_partition !== partition) {
            try {
                this.database.prepare('UPDATE users SET personal_partition = ? WHERE id = ?').run(partition, user_id);
            } catch (error) {
                if (is_constraint(error)) {
                    throw new control_error('conflict', `personal partition is already claimed: ${partition}`);
                }
                throw error;
            }
        }
        return this.require_user(user_id);
    }

    create_team(input: create_team_input): control_team {
        assert_id('team', input.id);
        const name = input.name?.trim() || input.id;
        if (this.get_team(input.id)) throw new control_error('conflict', `team already exists: ${input.id}`);
        try {
            this.database
                .prepare('INSERT INTO teams (id, name, created_at, disabled_at) VALUES (?, ?, ?, NULL)')
                .run(input.id, name, this.now());
        } catch (error) {
            if (is_constraint(error)) throw new control_error('conflict', `team already exists: ${input.id}`);
            throw error;
        }
        return this.require_team(input.id);
    }

    get_team(id: string): control_team | null {
        return this.raw<control_team>(
            'SELECT id, name, created_at, disabled_at FROM teams WHERE id = ?',
            id,
        ) ?? null;
    }

    list_teams(): control_team[] {
        return this.database
            .prepare(`SELECT ${team_columns} FROM teams ORDER BY id`)
            .all() as control_team[];
    }

    disable_team(id: string): control_team {
        const team = this.require_team(id);
        if (team.disabled_at === null) {
            this.database.prepare('UPDATE teams SET disabled_at = ? WHERE id = ?').run(this.now(), id);
        }
        return this.require_team(id);
    }

    add_member(team_id: string, user_id: string, role: control_role = 'member'): control_membership {
        const membership_role = assert_role(role);
        this.require_team(team_id);
        this.require_user(user_id);
        this.database
            .prepare(
                `INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT (team_id, user_id) DO UPDATE SET role = excluded.role`,
            )
            .run(team_id, user_id, membership_role, this.now());
        return this.membership(user_id, team_id) as control_membership;
    }

    remove_member(team_id: string, user_id: string): void {
        const result = this.database
            .prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?')
            .run(team_id, user_id);
        if (result.changes === 0) {
            throw new control_error('not_found', `user ${user_id} is not a member of team ${team_id}`);
        }
    }

    membership(user_id: string, team_id: string): control_membership | null {
        return this.raw<control_membership>(
            'SELECT team_id, user_id, role, created_at FROM team_members WHERE team_id = ? AND user_id = ?',
            team_id,
            user_id,
        ) ?? null;
    }

    list_memberships(user_id: string): control_membership[] {
        return this.database
            .prepare(
                `SELECT team_id, user_id, role, created_at FROM team_members
                 WHERE user_id = ? ORDER BY team_id`,
            )
            .all(user_id) as control_membership[];
    }

    list_team_members(team_id: string): control_membership[] {
        return this.database
            .prepare(
                `SELECT team_id, user_id, role, created_at FROM team_members
                 WHERE team_id = ? ORDER BY user_id`,
            )
            .all(team_id) as control_membership[];
    }

    create_token(input: create_token_input): control_token_record & { token: string } {
        const user = this.require_user(input.user_id);
        if (user.disabled_at !== null) throw new control_error('unauthorized', `user is disabled: ${user.id}`);
        const label = input.label?.trim();
        if (!label) throw new control_error('validation_error', 'token label must not be empty');
        const default_space = input.default_space ?? null;
        if (default_space !== null) this.assert_space(user.id, default_space);
        const expires_at = input.expires_at ?? null;
        if (expires_at !== null && !Number.isFinite(expires_at)) {
            throw new control_error('validation_error', 'token expiry must be a finite timestamp');
        }
        const value = create_token_value();
        this.database
            .prepare(
                `INSERT INTO tokens (
                    id, user_id, label, secret_hash, default_space, created_at, last_used_at, expires_at, revoked_at
                 ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
            )
            .run(value.id, user.id, label, value.secret_hash, default_space, this.now(), expires_at);
        return { ...this.require_token(value.id), token: value.token };
    }

    list_tokens(user_id?: string): control_token_record[] {
        const rows = user_id
            ? (this.database
                .prepare(`SELECT ${token_columns}, secret_hash FROM tokens WHERE user_id = ? ORDER BY created_at, id`)
                .all(user_id) as control_token_row[])
            : (this.database
                .prepare(`SELECT ${token_columns}, secret_hash FROM tokens ORDER BY created_at, id`)
                .all() as control_token_row[]);
        return rows.map(to_token_record);
    }

    revoke_token(id: string): control_token_record {
        const token = this.require_token(id);
        if (token.revoked_at === null) {
            this.database.prepare('UPDATE tokens SET revoked_at = ? WHERE id = ?').run(this.now(), id);
        }
        return this.require_token(id);
    }

    authenticate_token(value: string, now = this.now()): token_auth {
        const parsed = parse_token(value);
        if (!parsed) {
            secret_matches('invalid', dummy_hash);
            return { ok: false, code: 'unauthorized' };
        }
        const row = this.raw<control_token_row>('SELECT * FROM tokens WHERE id = ?', parsed.id);
        if (!row) {
            secret_matches(parsed.secret, dummy_hash);
            return { ok: false, code: 'unauthorized' };
        }
        if (!secret_matches(parsed.secret, row.secret_hash)) return { ok: false, code: 'unauthorized' };
        if (row.revoked_at !== null) return { ok: false, code: 'token_revoked' };
        if (row.expires_at !== null && now >= row.expires_at) return { ok: false, code: 'token_expired' };
        const user = this.get_user(row.user_id);
        if (!user || user.disabled_at !== null) return { ok: false, code: 'unauthorized' };
        const teams = this.enabled_memberships(user.id);
        const token = this.touch_token(row, now);
        return { ok: true, identity: { user, teams, token } };
    }

    spaces_for_user(user_id: string): control_space_record[] {
        const user = this.require_user(user_id);
        if (user.disabled_at !== null) throw new control_error('unauthorized', `user is disabled: ${user.id}`);
        const spaces: control_space_record[] = [
            { id: 'personal', kind: 'personal', team_id: null, role: 'owner', writable: true },
        ];
        for (const membership of this.enabled_memberships(user.id)) {
            spaces.push({
                id: `team:${membership.team_id}`,
                kind: 'team',
                team_id: membership.team_id,
                role: membership.role,
                writable: membership.role !== 'viewer',
            });
        }
        return spaces;
    }

    close(): void {
        if (!this.database.open) return;
        try {
            this.secure_files();
        } finally {
            this.database.close();
        }
    }

    private apply_schema(): void {
        const version = this.database.pragma('user_version', { simple: true }) as number;
        if (version > schema_version) {
            throw new Error(
                `control database schema version ${version} is newer than supported version ${schema_version}`,
            );
        }
        if (version === schema_version) return;
        this.database.transaction(() => {
            this.database.exec(schema);
            this.database.pragma(`user_version = ${schema_version}`);
        })();
    }

    private secure_files(): void {
        if (this.path === ':memory:') return;
        // The primary database holds token hashes and identities: a failed chmod must fail closed.
        chmodSync(this.path, 0o600);
        for (const sidecar of [`${this.path}-wal`, `${this.path}-shm`]) {
            try {
                chmodSync(sidecar, 0o600);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
        }
    }

    private require_user(id: string): control_user {
        const user = this.get_user(id);
        if (!user) throw new control_error('not_found', `unknown user: ${id}`);
        return user;
    }

    private require_team(id: string): control_team {
        const team = this.get_team(id);
        if (!team) throw new control_error('not_found', `unknown team: ${id}`);
        return team;
    }

    private require_token(id: string): control_token_record {
        const row = this.raw<control_token_row>('SELECT * FROM tokens WHERE id = ?', id);
        if (!row) throw new control_error('not_found', `unknown token: ${id}`);
        return to_token_record(row);
    }

    private user_for_partition(partition: string): control_user | null {
        return this.raw<control_user>(
            `SELECT ${user_columns} FROM users WHERE personal_partition = ?`,
            partition,
        ) ?? null;
    }

    private enabled_memberships(user_id: string): control_membership[] {
        return this.database
            .prepare(
                `SELECT m.team_id, m.user_id, m.role, m.created_at
                 FROM team_members AS m
                 JOIN teams AS t ON t.id = m.team_id
                 WHERE m.user_id = ? AND t.disabled_at IS NULL
                 ORDER BY m.team_id`,
            )
            .all(user_id) as control_membership[];
    }

    private touch_token(row: control_token_row, now: number): control_token_record {
        let last_used_at = row.last_used_at;
        if (last_used_at === null || now - last_used_at >= last_used_resolution_ms) {
            try {
                this.database.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(now, row.id);
                last_used_at = now;
            } catch {
                // last_used_at is advisory; a failed write must not reject a valid token.
            }
        }
        return to_token_record({ ...row, last_used_at });
    }

    private assert_space(user_id: string, space_id: string): void {
        if (space_id === 'personal') return;
        const team_id = space_id.startsWith('team:') ? space_id.slice('team:'.length) : null;
        if (!team_id || !id_pattern.test(team_id)) {
            throw new control_error('invalid_space', `invalid default space: ${space_id}`);
        }
        const team = this.get_team(team_id);
        if (!team || team.disabled_at !== null || !this.membership(user_id, team_id)) {
            throw new control_error('space_forbidden', `no access to default space: ${space_id}`);
        }
    }
}
