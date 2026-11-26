/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__,_/_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
*                      /____/                                 /____/
*
*  cavira oss (c) 2026  -  nullure (c) 2026
*  ----------------------------------------------------------
*  file  : integrations/kilo-longmemory/src/index.ts
*  usage : injects bounded LongMemory evidence into Kilo Code tasks
*/

import type { Hooks, Plugin } from '@kilocode/plugin';
import { ensure_longmemory_mcp } from './config.js';
import { resolve_context, session_context_cache, type context_options, type context_resolver } from './context.js';
import { memory_policy } from './policy.js';

export { ensure_longmemory_mcp, longmemory_mcp_server } from './config.js';
export { resolve_context, session_context_cache } from './context.js';
export { memory_policy } from './policy.js';

const configured_budget = (environment: NodeJS.ProcessEnv): number | undefined => {
    const raw = environment.LONGMEMORY_TOKEN_BUDGET;
    if (raw === undefined || !raw.trim()) return undefined;
    const value = Number(raw);
    return Number.isInteger(value) ? value : Number.NaN;
};

export function message_text(parts: readonly unknown[]): string {
    const text: string[] = [];
    for (const part of parts) {
        if (!part || typeof part !== 'object') continue;
        const value = part as { type?: unknown; text?: unknown; synthetic?: unknown };
        if (value.type !== 'text' || typeof value.text !== 'string' || value.synthetic === true) continue;
        text.push(value.text);
    }
    return text.join('\n').trim();
}

export const create_server = (deps: { resolve?: context_resolver } = {}): Plugin => async (input) => {
    const tasks = new Map<string, string>();
    const cache = new session_context_cache(deps.resolve ?? resolve_context);
    const environment = process.env;
    const cwd = input.directory;
    const token_budget = configured_budget(environment);

    const hooks: Hooks = {
        config: async (config) => { ensure_longmemory_mcp(config); },
        'chat.message': async (message_input, output) => {
            const task = message_text(output.parts);
            if (!task) return;
            tasks.set(message_input.sessionID, task);
            cache.invalidate(message_input.sessionID);
        },
        'experimental.chat.system.transform': async (transform_input, output) => {
            output.system.push(memory_policy);
            const session_id = transform_input.sessionID;
            if (!session_id) return;
            const task = tasks.get(session_id);
            if (!task) return;
            const options: context_options = { task, cwd, environment, token_budget };
            const context = await cache.resolve(session_id, options);
            if (context) output.system.push(context);
        },
    };
    return hooks;
};

const server = create_server();

export default { id: 'longmemory', server };
