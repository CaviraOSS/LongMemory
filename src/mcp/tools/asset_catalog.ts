/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ `/ __ `/ __ `/ /|_/ / _ / __ `__ / __ / ___/ / / /
*   / /___/ /_/ / / / /_/ / / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/ /____/_/   \__, /
*                      /____/                                 /____/
*
*  cavira oss (c) 2022  -  nullure (c) 2026
*  ----------------------------------------------------------
*  file  : src/mcp/tools/asset_catalog.ts
*  usage : implements the LongMemory asset catalog component
*/

import type { McpServer as mcp_server_sdk } from '@modelcontextprotocol/sdk/server/mcp.js';
import { asset_catalog_schema } from '../schemas/tool_schemas.js';
import type { mcp_runtime } from '../runtime.js';
import { resolve_agent, resolve_framework, resolve_project } from '../security/permissions.js';
import { run_audited_tool } from './common.js';
import { read_scopes, scoped_project } from './read_scope.js';

const required = (value: string | undefined, name: string): string => {
    if (!value) throw new Error(`${name} is required for this asset catalog action`);
    return value;
};

export function register_asset_catalog_tool(server: mcp_server_sdk, runtime: mcp_runtime): void {
    server.registerTool('longmemory_asset_catalog', {
        description: 'Discover governed Chat Memory, Skill, LLM-Wiki, and Code-Graph assets or assemble an explainable agent loadout.',
        inputSchema: asset_catalog_schema,
        annotations: { readOnlyHint: true, idempotentHint: true },
    }, async (input) => run_audited_tool(runtime, 'longmemory_asset_catalog', input, async () => {
        const scopes = read_scopes(runtime, input.space);
        if (scopes === 'all') {
            const results: Array<{ space: string; space_label: string; project_id: string; project_missing: boolean; assets: unknown[] }> = [];
            for (const space of runtime.spaces) {
                const child = runtime.for_space(space.id);
                const project_id = child.resolve_project_id(resolve_project(child.access, input.project_id));
                const project = await scoped_project(child, project_id);
                if (project === null) {
                    results.push({ space: space.id, space_label: space.label, project_id, project_missing: true, assets: [] });
                    continue;
                }
                const access = {
                    user_id: child.access.user_id, team_ids: [...child.access.team_ids], roles: [...child.access.roles],
                    agent_id: resolve_agent(child.access, input.agent_id), task_id: input.task_id,
                    framework: resolve_framework(child.access, input.framework),
                };
                if (input.action === 'loadout') {
                    const loadout = await project.resolveAssetLoadout(project_id, {
                        ...access, query: required(input.query, 'query'), include_unbound: input.include_unbound,
                        asset_types: input.asset_types, token_budget: input.token_budget,
                    });
                    results.push({ space: space.id, space_label: space.label, project_id, project_missing: false, assets: [{ action: 'loadout', loadout }] });
                    continue;
                }
                if (input.action === 'get') {
                    const asset_id = required(input.asset_id, 'asset_id');
                    const asset = await project.getAsset(project_id, asset_id);
                    if (!asset) {
                        results.push({ space: space.id, space_label: space.label, project_id, project_missing: true, assets: [] });
                        continue;
                    }
                    const decision = await project.decideAssetAccess(project_id, asset_id, access, 'read');
                    if (!decision.allowed) {
                        results.push({ space: space.id, space_label: space.label, project_id, project_missing: true, assets: [] });
                        continue;
                    }
                    results.push({ space: space.id, space_label: space.label, project_id, project_missing: false, assets: [{ action: 'get', asset, access: decision }] });
                    continue;
                }
                const assets = await project.listAssets(project_id);
                const visible: unknown[] = [];
                for (const asset of assets) {
                    const decision = await project.decideAssetAccess(project_id, asset.asset_id, access, 'read');
                    if (decision.allowed) visible.push(asset);
                }
                results.push({ space: space.id, space_label: space.label, project_id, project_missing: false, assets: visible });
            }
            return {
                space: 'all',
                spaces: results.map((r) => ({ space: r.space, space_label: r.space_label, project_id: r.project_id, project_missing: r.project_missing, assets: r.assets })),
                assets: results.flatMap((r) => r.assets),
            };
        }

        const space = scopes[0];
        const child = runtime.for_space(space.id);
        const project_id = child.resolve_project_id(resolve_project(child.access, input.project_id));
        const project = await scoped_project(child, project_id);
        if (project === null) {
            return {
                project_id,
                assets: [],
                space: space.id,
                space_label: space.label,
                project_missing: true,
            };
        }
        const access = {
            user_id: child.access.user_id, team_ids: [...child.access.team_ids], roles: [...child.access.roles],
            agent_id: resolve_agent(child.access, input.agent_id), task_id: input.task_id,
            framework: resolve_framework(child.access, input.framework),
        };
        if (input.action === 'loadout') return {
            ...await project.resolveAssetLoadout(project_id, {
                ...access, query: required(input.query, 'query'), include_unbound: input.include_unbound,
                asset_types: input.asset_types, token_budget: input.token_budget,
            }),
            space: space.id, space_label: space.label,
        };
        if (input.action === 'get') {
            const asset_id = required(input.asset_id, 'asset_id');
            const asset = await project.getAsset(project_id, asset_id);
            if (!asset) throw new Error(`asset ${asset_id} was not found or is not accessible`);
            const decision = await project.decideAssetAccess(project_id, asset_id, access, 'read');
            if (!decision.allowed) throw new Error(`asset ${asset_id} was not found or is not accessible`);
            return { project_id, asset, access: decision, space: space.id, space_label: space.label };
        }
        const assets = await project.listAssets(project_id);
        const visible: unknown[] = [];
        for (const asset of assets) {
            const decision = await project.decideAssetAccess(project_id, asset.asset_id, access, 'read');
            if (decision.allowed) visible.push(asset);
        }
        return { project_id, assets: visible, space: space.id, space_label: space.label };
    }));
}