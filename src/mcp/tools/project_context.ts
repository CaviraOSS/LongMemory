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
*  file  : src/mcp/tools/project_context.ts
*  usage : implements the LongMemory project context component
*/

import type { McpServer as mcp_server_sdk } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { mcp_runtime } from '../runtime.js';
import { project_context_schema } from '../schemas/tool_schemas.js';
import { resolve_agent, resolve_framework, resolve_project } from '../security/permissions.js';
import { run_audited_tool } from './common.js';
import { read_scopes, scoped_project, per_space_budget } from './read_scope.js';
import { empty_project_context, project_context_view } from '../../core/project/project_context_result.js';
import type { project_context_packet } from '../../core/project/project_context.js';

export function register_project_context_tool(server: mcp_server_sdk, runtime: mcp_runtime): void {
    server.registerTool('longmemory_project_context', {
        description: 'Return token-budgeted, permission-scoped context for coding, debugging, planning, or review.',
        inputSchema: project_context_schema,
        annotations: { readOnlyHint: true, idempotentHint: true },
    }, async (input) => run_audited_tool(runtime, 'longmemory_project_context', input, async () => {
        const scopes = read_scopes(runtime, input.space);
        const budget = input.token_budget ?? 2048;
        const task = `${input.mode}: ${input.task}`;
        const view = (project_id: string, packet: project_context_packet, space: { id: string; label: string }, child: mcp_runtime) => project_context_view(project_id, task, packet, {
            space: space.id,
            space_label: space.label,
            // The MCP tool has always let callers narrow relevant files and report the request's
            // working directory; keep that behavior while sharing the REST view shape.
            relevant_files: input.files?.length
                ? packet.relevant_files.filter((file) => input.files!.some((path) => file.path === path || file.path.endsWith(path)))
                : packet.relevant_files,
            debug_trace: { ...packet.debug_trace, mode: input.mode, cwd: input.cwd ?? child.cwd },
        });

        if (scopes === 'all') {
            const scoped_budget = per_space_budget(budget, runtime.spaces.length);
            const spaces = [];
            for (const space of runtime.spaces) {
                const child = runtime.for_space(space.id);
                const tags = { space: space.id, space_label: space.label };
                try {
                    const project_id = child.resolve_project_id(resolve_project(child.access, input.project_id));
                    const project = await scoped_project(child, project_id);
                    if (project === null) {
                        spaces.push(empty_project_context(project_id, task, scoped_budget, { ...tags, project_missing: true }));
                        continue;
                    }
                    const packet = await project.getProjectContext(
                        project_id, task, scoped_budget,
                        resolve_agent(child.access, input.agent_id), resolve_framework(child.access, input.framework),
                        { user_id: child.access.user_id, team_ids: [...child.access.team_ids], roles: [...child.access.roles], task_id: input.task_id },
                    );
                    spaces.push(view(project_id, packet, space, child));
                } catch (error) {
                    spaces.push({
                        ok: false, ...tags, project_missing: false, task,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
            return { space: 'all', spaces };
        }

        const space = scopes[0];
        const child = runtime.for_space(space.id);
        const project_id = child.resolve_project_id(resolve_project(child.access, input.project_id));
        const project = await scoped_project(child, project_id);
        if (project === null) {
            return empty_project_context(project_id, task, budget, {
                space: space.id,
                space_label: space.label,
                project_missing: true,
            });
        }

        const packet = await project.getProjectContext(
            project_id, task, budget,
            resolve_agent(child.access, input.agent_id), resolve_framework(child.access, input.framework),
            { user_id: child.access.user_id, team_ids: [...child.access.team_ids], roles: [...child.access.roles], task_id: input.task_id },
        );
        return view(project_id, packet, space, child);
    }));
}