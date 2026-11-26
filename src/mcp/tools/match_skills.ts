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
*  file  : src/mcp/tools/match_skills.ts
*  usage : implements the LongMemory match skills component
*/

import type { McpServer as mcp_server_sdk } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { mcp_runtime } from '../runtime.js';
import { match_skills_schema } from '../schemas/tool_schemas.js';
import { resolve_agent, resolve_project } from '../security/permissions.js';
import { run_audited_tool } from './common.js';
import { read_scopes, scoped_project } from './read_scope.js';

export function register_match_skills_tool(server: mcp_server_sdk, runtime: mcp_runtime): void {
    server.registerTool('longmemory_match_skills', {
        description: 'Match reusable project Skills for a task and optional agent loadout.',
        inputSchema: match_skills_schema,
        annotations: { readOnlyHint: true, idempotentHint: true },
    }, async (input) => run_audited_tool(runtime, 'longmemory_match_skills', input, async () => {
        const scopes = read_scopes(runtime, input.space);
        if (scopes === 'all') {
            const results: Array<{ space: string; space_label: string; project_id: string; project_missing: boolean; matches: unknown[] }> = [];
            for (const space of runtime.spaces) {
                const child = runtime.for_space(space.id);
                const project_id = child.resolve_project_id(resolve_project(child.access, input.project_id));
                const project = await scoped_project(child, project_id);
                if (project === null) {
                    results.push({ space: space.id, space_label: space.label, project_id, project_missing: true, matches: [] });
                    continue;
                }
                const agent_id = resolve_agent(child.access, input.agent_id);
                const matches = await project.matchSkills(project_id, input.query, agent_id, input.limit);
                const loadout = await project.resolveAssetLoadout(project_id, {
                    query: input.query, user_id: child.access.user_id, team_ids: [...child.access.team_ids], roles: [...child.access.roles],
                    agent_id, framework: child.access.framework ?? undefined, include_unbound: true, asset_types: ['skill'], token_budget: 32_768,
                });
                const governed = new Set(loadout.selected.map((item) => String(item.asset.payload.skill_id ?? '')));
                const known_assets = new Set([...loadout.selected.map((item) => item.asset.asset_id), ...loadout.excluded.map((item) => item.asset_id)]);
                results.push({
                    space: space.id,
                    space_label: space.label,
                    project_id,
                    project_missing: false,
                    matches: matches.filter((match) => governed.has(match.skill.skill_id) || !known_assets.has(`asset:skill:${match.skill.skill_id}`)),
                });
            }
            return {
                space: 'all',
                spaces: results.map((r) => ({ space: r.space, space_label: r.space_label, project_id: r.project_id, project_missing: r.project_missing, matches: r.matches })),
                matches: results.flatMap((r) => r.matches),
            };
        }

        const space = scopes[0];
        const child = runtime.for_space(space.id);
        const project_id = child.resolve_project_id(resolve_project(child.access, input.project_id));
        const project = await scoped_project(child, project_id);
        if (project === null) {
            return {
                project_id,
                query: input.query,
                agent_id: null,
                matches: [],
                space: space.id,
                space_label: space.label,
                project_missing: true,
            };
        }
        const agent_id = resolve_agent(child.access, input.agent_id);
        const matches = await project.matchSkills(project_id, input.query, agent_id, input.limit);
        const loadout = await project.resolveAssetLoadout(project_id, {
            query: input.query, user_id: child.access.user_id, team_ids: [...child.access.team_ids], roles: [...child.access.roles],
            agent_id, framework: child.access.framework ?? undefined, include_unbound: true, asset_types: ['skill'], token_budget: 32_768,
        });
        const governed = new Set(loadout.selected.map((item) => String(item.asset.payload.skill_id ?? '')));
        const known_assets = new Set([...loadout.selected.map((item) => item.asset.asset_id), ...loadout.excluded.map((item) => item.asset_id)]);
        return {
            project_id,
            query: input.query, agent_id: agent_id ?? null,
            matches: matches.filter((match) => governed.has(match.skill.skill_id) || !known_assets.has(`asset:skill:${match.skill.skill_id}`)),
            space: space.id,
            space_label: space.label,
        };
    }));
}