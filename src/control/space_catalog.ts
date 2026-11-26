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
*  file  : src/control/space_catalog.ts
*  usage : maps authenticated identities to memory partitions and spaces
*/

import { create_memory, type long_memory, type memory_config } from '../core/create_memory.js';
import type { mcp_access } from '../mcp/security/permissions.js';
import { create_tool_allowlist } from '../mcp/security/tool_allowlist.js';
import type { control_db } from './control_db.js';
import { control_error } from './errors.js';
import type { control_membership, control_role } from './types.js';

export type space_role = control_role | 'owner';

export type space_descriptor = {
    id: string;
    kind: 'personal' | 'team';
    label: string;
    team_id: string | null;
    role: space_role;
    partition: string;
    writable: boolean;
};

export type catalog_identity = {
    user_id: string;
    display_name: string;
    personal_partition: string;
    teams: control_membership[];
    default_space: string | null;
    auth: 'token' | 'legacy';
};

export type catalog_auth =
    | { ok: true; identity: catalog_identity }
    | { ok: false; code: 'unauthorized' | 'token_expired' | 'token_revoked' };

export type space_request_mode = 'read' | 'write';

export type space_catalog_config = {
    db_path: string;
    tenant_id: string;
    readonly?: boolean;
    control: control_db | null;
    memory: Omit<memory_config, 'store' | 'db_path' | 'tenant_id' | 'user_id' | 'readonly'>;
    legacy?: { user_id: string; display_name?: string; team_ids?: readonly string[]; memory?: long_memory };
    env?: NodeJS.ProcessEnv;
};

// Must match control_db's id pattern: `team:` is reserved for team partitions, so a malformed
// team id has to be rejected here exactly as the control plane rejects it.
const id_pattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const is_space_id = (id: string): boolean =>
    id === 'personal' || (id.startsWith('team:') && id_pattern.test(id.slice('team:'.length)));

export class space_catalog {
    private readonly config: space_catalog_config;
    private readonly control: control_db | null;
    private readonly memories = new Map<string, long_memory>();

    constructor(config: space_catalog_config) {
        this.config = config;
        this.control = config.control;
        // Personal and team partitions share the (tenant_id, user_id) key space. control_db already
        // rejects a personal partition containing ':', so legacy mode must uphold the same rule or a
        // team space could share a store with the personal space and leak memory across them.
        if (config.legacy?.user_id?.includes(':')) {
            throw new control_error(
                'validation_error',
                `legacy user id must not contain ':': ${config.legacy.user_id}`,
            );
        }
        for (const team_id of config.legacy?.team_ids ?? []) {
            if (!id_pattern.test(team_id)) {
                throw new control_error('validation_error', `invalid legacy team id: ${team_id}`);
            }
        }
    }

    authenticate_token(value: string, now?: number): catalog_auth {
        if (!this.control) return { ok: false, code: 'unauthorized' };
        const result = now === undefined
            ? this.control.authenticate_token(value)
            : this.control.authenticate_token(value, now);
        if (!result.ok) return { ok: false, code: result.code };
        const { user, teams, token } = result.identity;
        return {
            ok: true,
            identity: {
                user_id: user.id,
                display_name: user.display_name,
                personal_partition: user.personal_partition,
                teams,
                default_space: token.default_space,
                auth: 'token',
            },
        };
    }

    legacy_identity(): catalog_identity {
        const legacy = this.config.legacy;
        const user_id = legacy?.user_id?.trim() || 'default';
        const team_ids = [...new Set(legacy?.team_ids ?? [])];
        return {
            user_id,
            display_name: legacy?.display_name?.trim() || user_id,
            personal_partition: user_id,
            teams: team_ids.map((team_id) => ({ team_id, user_id, role: 'member' as const, created_at: 0 })),
            default_space: null,
            auth: 'legacy',
        };
    }

    spaces(identity: catalog_identity): space_descriptor[] {
        const spaces: space_descriptor[] = [{
            id: 'personal',
            kind: 'personal',
            label: identity.display_name,
            team_id: null,
            role: 'owner',
            partition: identity.personal_partition,
            writable: this.config.readonly !== true,
        }];
        const seen = new Set<string>();
        const memberships = [...identity.teams].sort((left, right) => left.team_id.localeCompare(right.team_id));
        for (const membership of memberships) {
            if (seen.has(membership.team_id)) continue;
            seen.add(membership.team_id);
            spaces.push(this.team_space(membership));
        }
        return spaces;
    }

    space(identity: catalog_identity, id: string): space_descriptor | null {
        return this.spaces(identity).find((space) => space.id === id) ?? null;
    }

    read_default(identity: catalog_identity): space_descriptor | 'all' {
        const spaces = this.spaces(identity);
        return spaces.length > 1 ? 'all' : spaces[0];
    }

    write_default(identity: catalog_identity): space_descriptor {
        if (identity.default_space === null) return this.spaces(identity)[0];
        const requested = this.space(identity, identity.default_space);
        if (!requested) {
            throw new control_error('space_forbidden', `no access to default space: ${identity.default_space}`);
        }
        return requested;
    }

    resolve_requested(identity: catalog_identity, requested: string, mode: space_request_mode): space_descriptor[] | 'all' {
        if (requested === 'all') {
            if (mode === 'write') throw new control_error('space_forbidden', 'space all is not writable');
            return 'all';
        }
        if (!is_space_id(requested)) throw new control_error('invalid_space', `invalid space: ${requested}`);
        const space = this.space(identity, requested);
        if (!space) throw new control_error('space_forbidden', `no access to space: ${requested}`);
        // `write_default` still returns a viewer's space so resources can read through it; an explicit
        // write request must fail here instead of deferring to a flag the caller may forget to check.
        if (mode === 'write' && !space.writable) {
            throw new control_error('space_forbidden', `space is not writable: ${requested}`);
        }
        return [space];
    }

    access_for(identity: catalog_identity, space: space_descriptor): mcp_access {
        return {
            user_id: identity.user_id,
            project_id: null,
            team_ids: space.team_id ? [space.team_id] : [],
            roles: space.kind === 'team' ? [space.role] : [],
            agent_id: null,
            framework: null,
            read_only: space.role === 'viewer' || this.config.readonly === true,
            allowed_tools: create_tool_allowlist(),
        };
    }

    memory_for(space: space_descriptor): long_memory {
        // Legacy servers already own a memory instance. Reusing it keeps one SQLite connection
        // per process and preserves the caller's lifecycle (the server closes it, not the catalog).
        if (this.config.legacy?.memory && space.id === 'personal') return this.config.legacy.memory;
        const cached = this.memories.get(space.partition);
        if (cached) return cached;
        const memory = create_memory({
            ...this.config.memory,
            store: 'sqlite',
            db_path: this.config.db_path,
            tenant_id: this.config.tenant_id,
            user_id: space.partition,
            readonly: this.config.readonly,
        });
        this.memories.set(space.partition, memory);
        return memory;
    }

    async close(): Promise<void> {
        const memories = [...this.memories.values()];
        this.memories.clear();
        await Promise.all(memories.map((memory) => memory.close()));
    }

    private team_space(membership: control_membership): space_descriptor {
        const id = `team:${membership.team_id}`;
        return {
            id,
            kind: 'team',
            label: this.control?.get_team(membership.team_id)?.name ?? membership.team_id,
            team_id: membership.team_id,
            role: membership.role,
            partition: id,
            writable: membership.role !== 'viewer' && this.config.readonly !== true,
        };
    }
}

export const create_space_catalog = (config: space_catalog_config): space_catalog => new space_catalog(config);
