/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__,_/_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/
*
*  cavira oss (c) 2026  -  nullure (c) 2026
*  ----------------------------------------------------------
*  file  : integrations/opencode-longmemory/src/index.ts
*  usage : injects bounded LongMemory evidence into OpenCode tasks
*/

import { Plugin } from '@opencode/plugin';
import { session_context_cache } from './context.js';

const configured_budget = (environment: NodeJS.ProcessEnv): number | undefined => {
    const raw = environment.LONGMEMORY_TOKEN_BUDGET;
    if (raw === undefined || !raw.trim()) return undefined;
    const value = Number(raw);
    return Number.isInteger(value) ? value : Number.NaN;
};

export default Plugin.define({
    id: 'caviraoss.longmemory',
    async setup(ctx) {
        const tasks = new Map<string, string>();
        const cache = new session_context_cache();
        const environment = process.env;
        const cwd = ctx.location.directory;
        const token_budget = configured_budget(environment);

        await ctx.session.hook('prompt', (event) => {
            const task = event.prompt.text.trim();
            if (!task) return;
            tasks.set(event.sessionID, task);
            cache.invalidate(event.sessionID);
        });

        await ctx.session.hook('context', async (event) => {
            const task = tasks.get(event.sessionID);
            if (!task) return;
            const context = await cache.resolve(event.sessionID, { task, cwd, environment, token_budget });
            if (context) event.system.push({ type: 'text', text: context });
        });
    },
});
