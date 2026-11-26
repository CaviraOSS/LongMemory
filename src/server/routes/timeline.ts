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
 *  file  : src/server/routes/timeline.ts
 *  usage : reads the historical timeline in one space or across spaces
 */


import type { timeline_params } from '../../core/create_memory.js';
import type { Timeline, TimelineEntry } from '../../core/recall/timeline_builder.js';
import type { permission_context_input } from '../middleware/errors.js';
import type { route_handler } from '../app.js';
import { api_error } from '../middleware/errors.js';

const time = (query: URLSearchParams, key: string) => {
    const raw = query.get(key);
    if (raw === null) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new api_error(400, 'validation_error', `${key} must be a finite number`);
    return value;
};

const unique_nodes = (groups: Array<Array<{ id: string }>>) => {
    const seen = new Map<string, { id: string }>();
    for (const group of groups) for (const node of group) seen.set(node.id, node);
    return [...seen.values()];
};

const merge_timelines = (entries: TimelineEntry[], timelines: Timeline[]): Timeline => ({
    entries: [...new Map(entries.map((entry) => [entry.id, entry])).values()].sort((a, b) => b.recorded_at - a.recorded_at || a.id.localeCompare(b.id)),
    chains: timelines.flatMap((timeline) => timeline.chains),
    world_truth_at_time: unique_nodes(timelines.map((timeline) => timeline.world_truth_at_time)) as Timeline['world_truth_at_time'],
    agent_belief_at_time: unique_nodes(timelines.map((timeline) => timeline.agent_belief_at_time)) as Timeline['agent_belief_at_time'],
    current_truth: unique_nodes(timelines.map((timeline) => timeline.current_truth)) as Timeline['current_truth'],
});

export const timeline_route: route_handler = async ({ config, query, runtime, identity, header_space }) => {
    const names = query.getAll('entity_names').flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean);
    const permission_user_id = query.get('permission_user_id') ?? undefined;
    const team_ids = query.getAll('permission_team_ids').flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean);
    const project_ids = query.getAll('permission_project_ids').flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean);
    const source_ids = query.getAll('permission_source_ids').flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean);
    const allow_private = query.get('permission_allow_private') === 'true';
    const has_permission_context = Boolean(permission_user_id || team_ids.length || project_ids.length || source_ids.length || allow_private);
    const permission_context: permission_context_input | undefined = has_permission_context ? {
        user_id: permission_user_id,
        team_ids: team_ids.length ? team_ids : undefined,
        project_ids: project_ids.length ? project_ids : undefined,
        source_ids: source_ids.length ? source_ids : undefined,
        allow_private: allow_private || undefined,
    } : undefined;
    if (config.control_db_path && permission_user_id && permission_user_id !== identity.user_id) {
        throw new api_error(403, 'identity_mismatch', 'user_id does not match the authenticated identity');
    }
    const narrowed = (personal: boolean): permission_context_input | undefined => {
        if (!permission_context) return undefined;
        if (!config.control_db_path) return permission_context;
        const memberships = new Set(identity.teams.map((team) => team.team_id));
        return {
            ...permission_context,
            user_id: identity.user_id,
            team_ids: permission_context.team_ids?.filter((team_id) => memberships.has(team_id)),
            allow_private: permission_context.allow_private === true && personal ? true : undefined,
        };
    };
    const input: timeline_params = {
        text: query.get('text') ?? undefined,
        now: time(query, 'now'),
        valid_time: time(query, 'valid_time'),
        recorded_time: time(query, 'recorded_time'),
        world_id: query.get('world_id') ?? undefined,
        entity_names: names.length ? names : undefined,
    };
    const requested = query.get('space') ?? header_space ?? undefined;
    const scopes = runtime.read_scopes(requested);

    if (scopes === 'all') {
        const results = [];
        for (const space of runtime.spaces) {
            const result = await runtime.for_space(space.id).memory.getTimeline({ ...input, permission_context: narrowed(space.id === 'personal') });
            results.push({ space, result });
        }
        return {
            data: {
                space: 'all',
                spaces: results.map(({ space }) => ({ space: space.id, space_label: space.label })),
                timeline: merge_timelines(results.flatMap(({ result }) => result.timeline.entries), results.map(({ result }) => result.timeline)),
                trace: {
                    query: input.text ?? '',
                    now: input.now ?? Date.now(),
                    valid_time: input.valid_time,
                    recorded_time: input.recorded_time,
                    entries: results.flatMap(({ result }) => result.trace.entries),
                    chains: results.flatMap(({ result }) => result.trace.chains),
                    retrieved: results.reduce((total, { result }) => total + result.trace.retrieved, 0),
                    relevant: results.reduce((total, { result }) => total + result.trace.relevant, 0),
                },
            },
        };
    }

    const space = scopes[0];
    const result = await runtime.for_space(space.id).memory.getTimeline({ ...input, permission_context: narrowed(space.id === 'personal') });
    return { data: { ...result, space: space.id, space_label: space.label } };
};
