/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ `/ __ `/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/
 *
 *  cavira oss (c) 2026  -  nullure (c) 2026
 *  ----------------------------------------------------------
 *  file  : src/server/routes/project_context.ts
 *  usage : serves space-scoped project context packets without creating projects
 */

import { empty_project_context, project_context_view } from '../../core/project/project_context_result.js';
import type { space_descriptor } from '../../control/space_catalog.js';
import type { route_handler } from '../app.js';
import { api_error, expect_record, optional_number, optional_string, required_string } from '../middleware/errors.js';

export const project_context_route: route_handler = async ({ body, config, runtime, identity, header_space }) => {
    const input = expect_record(body);
    const task = required_string(input, 'task');
    optional_string(input, 'project_id');
    optional_string(input, 'space');
    optional_string(input, 'agent');
    optional_string(input, 'framework');
    optional_number(input, 'token_budget');
    const token_budget = input.token_budget === undefined ? config.memory.max_context_tokens ?? 2048 : input.token_budget as number;
    if (!Number.isInteger(token_budget) || token_budget < 64 || token_budget > 1_000_000) {
        throw new api_error(400, 'validation_error', 'token_budget must be an integer between 64 and 1000000');
    }
    const requested_project = typeof input.project_id === 'string' && input.project_id.trim() ? input.project_id.trim() : null;
    const project_id = runtime.resolve_project_id(requested_project);
    const agent = typeof input.agent === 'string' ? input.agent : undefined;
    const framework = typeof input.framework === 'string' ? input.framework : undefined;
    const requested = (typeof input.space === 'string' ? input.space : header_space) ?? undefined;
    const scopes = runtime.read_scopes(requested);

    const packet = async (space: space_descriptor, budget: number) => {
        const child = runtime.for_space(space.id);
        const manager = await child.find_project(child.resolve_project_id(project_id));
        const tags = { space: space.id, space_label: space.label };
        if (!manager) return empty_project_context(project_id, task, budget, tags);
        const context = await manager.getProjectContext(project_id, task, budget, agent, framework, { user_id: identity.user_id });
        return project_context_view(project_id, task, context, tags);
    };

    if (scopes === 'all') {
        const budget = Math.max(64, Math.floor(token_budget / runtime.spaces.length));
        const spaces = [];
        for (const space of runtime.spaces) spaces.push(await packet(space, budget));
        return {
            data: {
                ok: true,
                schema: 'longmemory.project-context.v1',
                project_id,
                task,
                space: 'all',
                spaces,
            },
        };
    }
    return { data: await packet(scopes[0], token_budget) };
};
