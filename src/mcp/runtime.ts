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
 *  file  : src/mcp/runtime.ts
 *  usage : implements the LongMemory runtime component
 */


import { basename, resolve } from 'node:path';
import { create_memory, type long_memory } from '../core/create_memory.js';
import type { ConnectorRegistry } from '../core/connectors/connector_registry.js';
import { project_memory } from '../core/project/project_memory.js';
import type { World } from '../core/types/world.js';
import type { catalog_identity, space_catalog, space_descriptor } from '../control/space_catalog.js';
import { control_error } from '../control/errors.js';
import { mcp_audit_log } from './security/audit.js';
import { create_embedding_environment } from '../core/embeddings/environment.js';
import { create_tool_allowlist, type mcp_tool_name } from './security/tool_allowlist.js';
import type { mcp_access } from './security/permissions.js';

export type mcp_runtime_config = {
    memory?: long_memory;
    db_path?: string;
    tenant_id?: string;
    user_id?: string;
    project_id?: string | null;
    team_ids?: readonly string[];
    roles?: readonly string[];
    agent_id?: string | null;
    framework?: string | null;
    cwd?: string;
    read_only?: boolean;
    allowed_tools?: readonly mcp_tool_name[];
    audit?: mcp_audit_log;
    audit_path?: string | null;
    connector_registry?: ConnectorRegistry;
    env?: NodeJS.ProcessEnv;
    catalog?: space_catalog;
    identity?: catalog_identity;
    space?: space_descriptor;
    space_id?: string;
    space_explicit?: boolean;
    requested_space?: string | null;
};

export type mcp_project_options = { create?: boolean };

export const current_project_id = (cwd: string) => basename(resolve(cwd)).toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'current';

export class mcp_runtime {
    readonly identity: catalog_identity;
    readonly space: space_descriptor;
    readonly spaces: readonly space_descriptor[];
    readonly space_id: string;
    readonly space_explicit: boolean;
    readonly requested_space: string | null;
    readonly access: mcp_access;
    readonly audit: mcp_audit_log;
    readonly cwd: string;
    readonly tenant_id: string;
    private readonly catalog: space_catalog | null;
    private readonly legacy_memory: long_memory | null;
    private readonly owns_memory: boolean;
    private readonly connector_registry?: ConnectorRegistry;
    private projects = new Map<string, project_memory>();
    private owns_projects = true;

    constructor(config: mcp_runtime_config = {}) {
        this.cwd = resolve(config.cwd ?? process.cwd());
        this.tenant_id = config.tenant_id ?? 'default';
        this.connector_registry = config.connector_registry;
        const project_id = config.project_id === 'current' ? current_project_id(this.cwd) : config.project_id ?? null;

        let identity: catalog_identity;
        let space: space_descriptor;
        let spaces: readonly space_descriptor[];
        let catalog: space_catalog | null = null;
        let legacy_memory: long_memory | null = null;
        let owns_memory = false;
        let access: mcp_access;

        if (config.catalog) {
            if (!config.identity) throw new control_error('validation_error', 'a space catalog requires an identity');
            catalog = config.catalog;
            identity = config.identity;
            spaces = catalog.spaces(identity);
            const requested = config.space_id ?? catalog.write_default(identity).id;
            const resolved = config.space ?? catalog.space(identity, requested);
            if (!resolved) throw new control_error('space_forbidden', `no access to space: ${requested}`);
            space = resolved;
            access = {
                ...catalog.access_for(identity, space),
                project_id,
                agent_id: config.agent_id ?? null,
                framework: config.framework ?? null,
                allowed_tools: create_tool_allowlist(config.allowed_tools),
            };
        } else {
            const user_id = config.identity?.user_id ?? config.user_id ?? 'default';
            identity = config.identity ?? {
                user_id,
                display_name: user_id,
                personal_partition: user_id,
                teams: [],
                default_space: null,
                auth: 'legacy',
            };
            space = {
                id: 'personal',
                kind: 'personal',
                label: identity.display_name,
                team_id: null,
                role: 'owner',
                partition: identity.personal_partition,
                writable: config.read_only !== true,
            };
            spaces = [space];
            const embeddings = create_embedding_environment(config.env ?? process.env);
            legacy_memory = config.memory ?? create_memory({
                store: config.db_path ? 'sqlite' : 'memory',
                db_path: config.db_path,
                tenant_id: this.tenant_id,
                user_id,
                readonly: config.read_only ?? false,
                ...(embeddings ? { embedding_provider: embeddings.embedding_provider, multilingual_embedding_provider: embeddings.multilingual_embedding_provider, embedding_dimension: embeddings.embedding_dimension } : {}),
            });
            owns_memory = !config.memory;
            access = {
                user_id,
                project_id,
                team_ids: config.team_ids ?? [],
                roles: config.roles ?? [],
                agent_id: config.agent_id ?? null,
                framework: config.framework ?? null,
                read_only: config.read_only ?? false,
                allowed_tools: create_tool_allowlist(config.allowed_tools),
            };
        }

        this.identity = identity;
        this.space = space;
        this.spaces = spaces;
        this.space_id = space.id;
        this.space_explicit = config.space_explicit ?? false;
        this.requested_space = config.requested_space ?? null;
        this.catalog = catalog;
        this.legacy_memory = legacy_memory;
        this.owns_memory = owns_memory;
        this.access = access;
        this.audit = config.audit ?? new mcp_audit_log(config.audit_path ?? (config.db_path ? `${config.db_path}.mcp-audit.jsonl` : null));
    }

    get memory(): long_memory {
        if (!this.catalog) {
            if (!this.legacy_memory) throw new Error('runtime has no memory');
            return this.legacy_memory;
        }
        if (this.space.id === 'all') throw new control_error('space_forbidden', 'an all-space runtime has no single memory');
        return this.catalog.memory_for(this.space);
    }

    read_scopes(requested?: string): space_descriptor[] | 'all' {
        // A header-level space is an explicit scope even when a caller omits the tool argument.
        const scope = requested ?? this.requested_space ?? undefined;
        if (!this.catalog) {
            if (scope === undefined || scope === 'personal') return [this.space];
            if (scope === 'all') return 'all';
            throw new control_error('space_forbidden', `no access to space: ${scope}`);
        }
        if (scope !== undefined) return this.catalog.resolve_requested(this.identity, scope, 'read');
        if (this.space_explicit) return [this.space];
        const fallback = this.catalog.read_default(this.identity);
        return fallback === 'all' ? 'all' : [fallback];
    }

    write_scope(requested?: string): space_descriptor {
        const scope = requested ?? this.requested_space ?? undefined;
        if (scope === 'all') throw new control_error('space_forbidden', 'space all is not writable');
        if (scope !== undefined) {
            if (!this.catalog) {
                if (scope !== 'personal') throw new control_error('space_forbidden', `no access to space: ${scope}`);
                return this.space;
            }
            const resolved = this.catalog.resolve_requested(this.identity, scope, 'write');
            if (resolved === 'all') throw new control_error('space_forbidden', 'space all is not writable');
            return resolved[0];
        }
        // The implicit write space is usually the token's default. `write_default` deliberately
        // resolves viewer spaces so resources can read through them, so the write path has to
        // enforce writability itself instead of trusting the descriptor.
        if (!this.space.writable || this.access.read_only) {
            throw new control_error('space_forbidden', `space is not writable: ${this.space.id}`);
        }
        return this.space;
    }

    for_space(space_id: string): mcp_runtime {
        const space = this.catalog
            ? this.catalog.space(this.identity, space_id)
            : space_id === 'personal' ? this.space : null;
        if (!space) throw new control_error('space_forbidden', `no access to space: ${space_id}`);
        const child = new mcp_runtime({
            catalog: this.catalog ?? undefined,
            identity: this.identity,
            space,
            space_explicit: true,
            memory: this.catalog ? undefined : this.memory,
            tenant_id: this.tenant_id,
            project_id: this.access.project_id,
            team_ids: this.access.team_ids,
            roles: this.access.roles,
            agent_id: this.access.agent_id,
            framework: this.access.framework,
            read_only: this.access.read_only,
            allowed_tools: [...this.access.allowed_tools],
            cwd: this.cwd,
            audit: this.audit,
            connector_registry: this.connector_registry,
        });
        child.projects = this.projects;
        child.owns_projects = false;
        return child;
    }

    async find_project(project_id?: string | null): Promise<project_memory | null> {
        const id = this.resolve_project_id(project_id);
        const cached = this.projects.get(this.project_key(id));
        if (cached) return cached;
        const worlds = await this.memory.listWorlds();
        const root = this.project_root(worlds, id);
        if (!root) return null;
        const manager = this.project_manager(id, root);
        await manager.openProject(this.project_config(id, root));
        this.projects.set(this.project_key(id), manager);
        return manager;
    }

    async project(project_id?: string | null, options: mcp_project_options = {}): Promise<project_memory> {
        const create = options.create ?? true;
        const id = this.resolve_project_id(project_id);
        if (create && this.access.read_only) throw new Error(`MCP server is read-only; unknown project cannot be created: ${id}`);
        const cached = this.projects.get(this.project_key(id));
        if (cached) return cached;
        const worlds = await this.memory.listWorlds();
        const root = this.project_root(worlds, id);
        if (!root && !create) throw new control_error('project_not_found', `project not found: ${id}`);
        const manager = this.project_manager(id, root);
        const config = this.project_config(id, root);
        if (create) await manager.createProject(config);
        else await manager.openProject(config);
        this.projects.set(this.project_key(id), manager);
        return manager;
    }

    resolve_project_id(project_id?: string | null): string {
        if (project_id === 'current') return current_project_id(this.cwd);
        return project_id ?? this.access.project_id ?? current_project_id(this.cwd);
    }

    async list_projects(): Promise<Array<Record<string, unknown>>> {
        const worlds = await this.memory.listWorlds();
        const allowed = this.access.project_id;
        const roots = worlds.filter((world) => world.metadata.hierarchy === 'project' && (!allowed || world.metadata.project_id === allowed));
        return roots.map((world) => ({
            tenant_id: String(world.metadata.tenant_id ?? this.tenant_id),
            organization_id: String(world.metadata.organization_id ?? this.tenant_id),
            project_id: String(world.metadata.project_id),
            name: world.name,
            description: String(world.metadata.description ?? ''),
            root_world_id: world.id,
            world_ids: Object.fromEntries(worlds.filter((child) => child.parent_world_id === world.id).map((child) => [String(child.metadata.hierarchy), child.id])),
            created_at: world.created_at,
            updated_at: world.updated_at,
        }));
    }

    async close(): Promise<void> {
        if (this.owns_projects) {
            const managers = [...this.projects.values()];
            this.projects.clear();
            for (const manager of managers) await manager.close();
        }
        if (this.owns_memory) await this.legacy_memory?.close();
    }

    private project_root(worlds: World[], project_id: string): World | undefined {
        return worlds.find((world) => world.metadata.hierarchy === 'project' && world.metadata.project_id === project_id);
    }

    private project_key(project_id: string): string {
        return `${this.space_id}:${project_id}`;
    }

    private project_manager(project_id: string, root?: World): project_memory {
        const config = this.project_config(project_id, root);
        return new project_memory({
            memory: this.memory,
            tenant_id: this.tenant_id,
            project_id,
            name: config.name,
            description: config.description,
            connector_registry: this.connector_registry,
            readonly: this.access.read_only,
        });
    }

    private project_config(project_id: string, root?: World) {
        return {
            tenant_id: this.tenant_id,
            project_id,
            name: root?.name ?? project_id,
            description: String(root?.metadata.description ?? `LongMemory project ${project_id}`),
        };
    }
}
