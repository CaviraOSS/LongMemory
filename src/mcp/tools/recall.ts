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
*  file  : src/mcp/tools/recall.ts
*  usage : implements the LongMemory recall component
*/

import type { McpServer as mcp_server_sdk } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { mcp_runtime } from '../runtime.js';
import { recall_schema } from '../schemas/tool_schemas.js';
import { recall_permission, resolve_project } from '../security/permissions.js';
import { run_audited_tool } from './common.js';
import { read_scopes, merge_scoped_recall, per_space_budget, scoped_project } from './read_scope.js';

const sanitize_recall = (result: unknown): unknown => {
    if (!result || typeof result !== 'object') return result;
    const value = result as Record<string, any>;
    let next = value;
    if (next.trace && typeof next.trace === 'object' && Array.isArray(next.trace.candidates)) {
        next = {
            ...next,
            trace: {
                ...next.trace,
                candidates: next.trace.candidates.filter((candidate: Record<string, unknown>) => candidate.accepted === true || candidate.included === true),
            },
        };
    }
    if (Array.isArray(next.items) && next.context && Array.isArray(next.context.items)) {
        const full_node_ids = new Set(next.items.map((item: Record<string, unknown>) => (item.node as Record<string, unknown> | undefined)?.id).filter(Boolean));
        next = {
            ...next,
            context: {
                ...next.context,
                items: next.context.items.map((node: Record<string, unknown>) => full_node_ids.has(node?.id) ? { id: node.id } : node),
            },
        };
    }
    return next;
};

const recall_entry = (space: { id: string; label: string }, result: Record<string, any>) => ({
    space: space.id,
    space_label: space.label,
    project_missing: false,
    items: (result.items ?? []).map((item: any) => ({ node: { id: item.node.id }, score: item.score })),
    timeline: result.timeline ?? { entries: [], current_truth: [], world_truth_at_time: [], agent_belief_at_time: [] },
    context: result.context ?? { text: '' },
    tokens_used: result.tokens_used ?? 0,
    budget: result.budget ?? 256,
    item_count: result.items?.length ?? 0,
    evidence: result.evidence ?? 0,
    bundled_items: result.bundled_items ?? 0,
    within_budget: result.within_budget ?? true,
});

export function register_recall_tool(server: mcp_server_sdk, runtime: mcp_runtime): void {
    server.registerTool('longmemory_recall', {
        description: 'Recall memory through the selected Hydrograph mode without bypassing gates.',
        inputSchema: recall_schema,
        annotations: { readOnlyHint: true, idempotentHint: true },
    }, async (input) => run_audited_tool(runtime, 'longmemory_recall', input, async () => {
        const scopes = read_scopes(runtime, input.space);
        const budget = input.token_budget ?? 256;
        if (scopes === 'all') {
            const scoped_budget = per_space_budget(budget, runtime.spaces.length);
            const results = [];
            for (const space of runtime.spaces) {
                const child = runtime.for_space(space.id);
                try {
                    const project_id = child.resolve_project_id(resolve_project(child.access, input.project_id));
                    const project = await scoped_project(child, project_id);
                    if (project === null) {
                        results.push({
                            space: space.id,
                            space_label: space.label,
                            project_missing: true,
                            items: [],
                            timeline: { entries: [], current_truth: [], world_truth_at_time: [], agent_belief_at_time: [] },
                            context: { text: '' },
                            tokens_used: 0,
                            budget: scoped_budget,
                            item_count: 0,
                            evidence: 0,
                            bundled_items: 0,
                            within_budget: true,
                        });
                        continue;
                    }
                    const world_id = project.getProject(project_id).root_world_id;
                    const result = await child.memory.recall({
                        text: input.query,
                        mode: input.mode,
                        token_budget: scoped_budget,
                        world_id,
                        permission_context: recall_permission(child.access, input.user_id, project_id),
                    });
                    results.push(recall_entry(space, result as Record<string, any>));
                } catch (error) {
                    // One inaccessible or damaged partition must not hide the other spaces' results.
                    results.push({
                        space: space.id,
                        space_label: space.label,
                        project_missing: false,
                        error: error instanceof Error ? error.message : String(error),
                        items: [],
                        timeline: { entries: [], current_truth: [], world_truth_at_time: [], agent_belief_at_time: [] },
                        context: { text: '' },
                        tokens_used: 0,
                        budget: scoped_budget,
                        item_count: 0,
                        evidence: 0,
                        bundled_items: 0,
                        within_budget: true,
                    });
                }
            }
            return merge_scoped_recall(results, budget);
        }

        const space = scopes[0];
        const child = runtime.for_space(space.id);
        const project_id = child.resolve_project_id(resolve_project(child.access, input.project_id));
        const project = await scoped_project(child, project_id);
        if (project === null) {
            return {
                project_id,
                space: space.id,
                space_label: space.label,
                project_missing: true,
                items: [],
                timeline: { entries: [], current_truth: [], world_truth_at_time: [], agent_belief_at_time: [] },
                context: { text: '' },
                tokens_used: 0,
                budget,
                item_count: 0,
                evidence: 0,
                bundled_items: 0,
                within_budget: true,
            };
        }

        const world_id = project.getProject(project_id).root_world_id;
        const result = await child.memory.recall({
            text: input.query,
            mode: input.mode,
            token_budget: budget,
            world_id,
            permission_context: recall_permission(child.access, input.user_id, project_id),
        });
        return {
            ...(sanitize_recall(result) as Record<string, unknown>),
            space: space.id,
            space_label: space.label,
        };
    }));
}