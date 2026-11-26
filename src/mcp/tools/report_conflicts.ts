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
*  file  : src/mcp/tools/report_conflicts.ts
*  usage : implements the LongMemory report conflicts component
*/

import type { McpServer as mcp_server_sdk } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { mcp_runtime } from '../runtime.js';
import { report_conflicts_schema } from '../schemas/tool_schemas.js';
import { resolve_project } from '../security/permissions.js';
import { run_audited_tool } from './common.js';
import { read_scopes, scoped_project } from './read_scope.js';

export function register_report_conflicts_tool(server: mcp_server_sdk, runtime: mcp_runtime): void {
    server.registerTool('longmemory_report_conflicts', {
        description: 'Report unresolved contradictions in project-scoped memory.',
        inputSchema: report_conflicts_schema,
        annotations: { readOnlyHint: true, idempotentHint: true },
    }, async (input) => run_audited_tool(runtime, 'longmemory_report_conflicts', input, async () => {
        const scopes = read_scopes(runtime, input.space);
        if (scopes === 'all') {
            const results: Array<{ space: string; space_label: string; project_id: string; project_missing: boolean; conflicts: unknown[] }> = [];
            for (const space of runtime.spaces) {
                const child = runtime.for_space(space.id);
                const project_id = child.resolve_project_id(resolve_project(child.access, input.project_id));
                const project = await scoped_project(child, project_id);
                if (project === null) {
                    results.push({ space: space.id, space_label: space.label, project_id, project_missing: true, conflicts: [] });
                    continue;
                }
                const recalled = await project.recallProject(project_id, { text: '', token_budget: 256 }, 'project_historical');
                results.push({
                    space: space.id,
                    space_label: space.label,
                    project_id,
                    project_missing: false,
                    conflicts: recalled.contradictions,
                });
            }
            return {
                space: 'all',
                spaces: results.map((r) => ({ space: r.space, space_label: r.space_label, project_id: r.project_id, project_missing: r.project_missing, conflicts: r.conflicts })),
                conflicts: results.flatMap((r) => r.conflicts),
                count: results.reduce((sum, r) => sum + r.conflicts.length, 0),
                severity: input.severity ?? 'warning',
            };
        }

        const space = scopes[0];
        const child = runtime.for_space(space.id);
        const project_id = child.resolve_project_id(resolve_project(child.access, input.project_id));
        const project = await scoped_project(child, project_id);
        if (project === null) {
            return {
                project_id,
                severity: input.severity ?? 'warning',
                conflicts: [],
                count: 0,
                space: space.id,
                space_label: space.label,
                project_missing: true,
            };
        }
        const recalled = await project.recallProject(project_id, { text: '', token_budget: 256 }, 'project_historical');
        return {
            project_id,
            severity: input.severity ?? 'warning',
            conflicts: recalled.contradictions,
            count: recalled.contradictions.length,
            space: space.id,
            space_label: space.label,
        };
    }));
}