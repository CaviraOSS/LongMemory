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
 *  file  : src/server/routes/recall.ts
 *  usage : recalls memory in one space or merges every accessible space
 */


import type { public_recall_query, recall_mode } from '../../core/create_memory.js';
import type { catalog_identity, space_descriptor } from '../../control/space_catalog.js';
import { control_error } from '../../control/errors.js';
import { merge_scoped_recall, per_space_budget } from '../../mcp/tools/read_scope.js';
import type { permission_context_input } from '../middleware/errors.js';
import type { route_handler } from '../app.js';
import { api_error, expect_record, optional_array, optional_number, optional_permission_context, optional_string, required_string } from '../middleware/errors.js';

const modes: recall_mode[] = ['strict', 'historical', 'associative', 'world_grounded'];

// Control mode treats permission fields as filters: they can narrow the token's access but never
// widen it. Legacy mode keeps the historical pass-through behavior.
const narrow_permission = (
    requested: permission_context_input | undefined,
    identity: catalog_identity,
    space: space_descriptor,
): permission_context_input | undefined => {
    if (!requested) return undefined;
    if (requested.user_id && requested.user_id !== identity.user_id) {
        throw new control_error('identity_mismatch', 'user_id does not match the authenticated identity');
    }
    if (!requested.team_ids) return {
        ...requested,
        user_id: identity.user_id,
        allow_private: requested.allow_private === true && space.id === 'personal' ? true : undefined,
    };
    const memberships = new Set(identity.teams.map((team) => team.team_id));
    return {
        ...requested,
        user_id: identity.user_id,
        team_ids: requested.team_ids.filter((team_id) => memberships.has(team_id)),
        allow_private: requested.allow_private === true && space.id === 'personal' ? true : undefined,
    };
};

export const recall_route: route_handler = async ({ body, config, runtime, identity, header_space }) => {
    const input = expect_record(body);
    required_string(input, 'text');
    optional_string(input, 'space');
    const mode = required_string(input, 'mode') as recall_mode;
    if (!modes.includes(mode)) throw new api_error(400, 'validation_error', `mode must be one of: ${modes.join(', ')}`);
    optional_string(input, 'world_id');
    for (const key of ['now', 'at', 'valid_time', 'recorded_time', 'k', 'token_budget', 'min_confidence', 'min_freshness', 'min_source_reliability', 'grounding_threshold']) optional_number(input, key);
    optional_array(input, 'entity_names', 'string');
    optional_array(input, 'vector', 'number');
    const permission_context = optional_permission_context(input);
    const requested = (typeof input.space === 'string' ? input.space : header_space) ?? undefined;
    const budget = typeof input.token_budget === 'number' ? input.token_budget : 256;
    const { space: _space, permission_context: _permission, ...query } = input;
    void _space;
    void _permission;
    const scopes = runtime.read_scopes(requested);

    if (scopes === 'all') {
        const scoped_budget = per_space_budget(budget, runtime.spaces.length);
        const results = [];
        for (const space of runtime.spaces) {
            const child = runtime.for_space(space.id);
            try {
                const result = await child.memory.recall({
                    ...query,
                    token_budget: scoped_budget,
                    permission_context: config.control_db_path ? narrow_permission(permission_context, identity, space) : permission_context,
                } as unknown as public_recall_query);
                results.push({ space: space.id, space_label: space.label, project_missing: false, budget: scoped_budget, ...(result as Record<string, unknown>) });
            } catch (error) {
                results.push({
                    space: space.id, space_label: space.label, project_missing: false,
                    error: error instanceof Error ? error.message : String(error),
                    items: [], timeline: { entries: [], current_truth: [], world_truth_at_time: [], agent_belief_at_time: [] },
                    context: { text: '' }, tokens_used: 0, budget: scoped_budget, item_count: 0,
                    evidence: 0, bundled_items: 0, within_budget: true,
                });
            }
        }
        return { data: merge_scoped_recall(results, budget) };
    }

    const space = scopes[0];
    const child = runtime.for_space(space.id);
    const result = await child.memory.recall({
        ...query,
        permission_context: config.control_db_path ? narrow_permission(permission_context, identity, space) : permission_context,
    } as unknown as public_recall_query);
    return { data: { ...(result as Record<string, unknown>), space: space.id, space_label: space.label } };
};
