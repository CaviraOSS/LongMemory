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
 *  file  : src/server/routes/explain.ts
 *  usage : explains one memory in the requested or first matching space
 */


import type { route_handler } from '../app.js';
import { api_error } from '../middleware/errors.js';

export const explain_route: route_handler = async ({ params, query, runtime, header_space }) => {
    const requested = query.get('space') ?? header_space ?? undefined;
    const scopes = runtime.read_scopes(requested);
    const spaces = scopes === 'all' ? runtime.spaces : scopes;
    for (const space of spaces) {
        const data = await runtime.for_space(space.id).memory.explain(params.id);
        if (data.node) return { data: { ...data, space: space.id, space_label: space.label } };
    }
    throw new api_error(404, 'memory_not_found', 'Memory not found');
};
