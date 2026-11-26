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
*  file  : src/mcp/tools/code_graph.ts
*  usage : implements the LongMemory code graph component
*/

import type { McpServer as mcp_server_sdk } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { mcp_runtime } from '../runtime.js';
import { code_graph_schema } from '../schemas/tool_schemas.js';
import { resolve_project } from '../security/permissions.js';
import { run_audited_tool } from './common.js';
import { read_scopes, scoped_project } from './read_scope.js';

const required = (value: string | undefined, name: string): string => {
    if (!value) throw new Error(`${name} is required for this code graph action`);
    return value;
};

export function register_code_graph_tool(server: mcp_server_sdk, runtime: mcp_runtime): void {
    server.registerTool('longmemory_code_graph', {
        description: 'Search code symbols, inspect callers/callees, or trace reverse impact paths in a project snapshot.',
        inputSchema: code_graph_schema,
        annotations: { readOnlyHint: true, idempotentHint: true },
    }, async (input) => run_audited_tool(runtime, 'longmemory_code_graph', input, async () => {
        const scopes = read_scopes(runtime, input.space);
        if (scopes === 'all') {
            const results: Array<{ space: string; space_label: string; project_id: string; project_missing: boolean; symbols: unknown[] }> = [];
            for (const space of runtime.spaces) {
                const child = runtime.for_space(space.id);
                const project_id = child.resolve_project_id(resolve_project(child.access, input.project_id));
                const project = await scoped_project(child, project_id);
                if (project === null) {
                    results.push({ space: space.id, space_label: space.label, project_id, project_missing: true, symbols: [] });
                    continue;
                }
                if (input.action === 'search') {
                    const symbols = await project.searchCodeSymbols(project_id, required(input.query, 'query'), input.limit);
                    results.push({ space: space.id, space_label: space.label, project_id, project_missing: false, symbols });
                    continue;
                }
                const symbol = required(input.symbol, 'symbol');
                if (input.action === 'callers') {
                    results.push({ space: space.id, space_label: space.label, project_id, project_missing: false, symbols: await project.getCodeCallers(project_id, symbol) });
                    continue;
                }
                if (input.action === 'callees') {
                    results.push({ space: space.id, space_label: space.label, project_id, project_missing: false, symbols: await project.getCodeCallees(project_id, symbol) });
                    continue;
                }
                results.push({ space: space.id, space_label: space.label, project_id, project_missing: false, symbols: await project.getCodeImpact(project_id, symbol, input.max_depth) });
            }
            return {
                space: 'all',
                spaces: results.map((r) => ({ space: r.space, space_label: r.space_label, project_id: r.project_id, project_missing: r.project_missing, symbols: r.symbols })),
                symbols: results.flatMap((r) => r.symbols),
            };
        }

        const space = scopes[0];
        const child = runtime.for_space(space.id);
        const project_id = child.resolve_project_id(resolve_project(child.access, input.project_id));
        const project = await scoped_project(child, project_id);
        if (project === null) {
            return {
                project_id,
                action: input.action,
                symbols: [],
                space: space.id,
                space_label: space.label,
                project_missing: true,
            };
        }
        if (input.action === 'search') return { project_id: project_id, action: input.action, symbols: await project.searchCodeSymbols(project_id, required(input.query, 'query'), input.limit), space: space.id, space_label: space.label };
        const symbol = required(input.symbol, 'symbol');
        if (input.action === 'callers') return { project_id: project_id, action: input.action, symbol, callers: await project.getCodeCallers(project_id, symbol), space: space.id, space_label: space.label };
        if (input.action === 'callees') return { project_id: project_id, action: input.action, symbol, callees: await project.getCodeCallees(project_id, symbol), space: space.id, space_label: space.label };
        return { project_id: project_id, action: input.action, symbol, impact: await project.getCodeImpact(project_id, symbol, input.max_depth), space: space.id, space_label: space.label };
    }));
}