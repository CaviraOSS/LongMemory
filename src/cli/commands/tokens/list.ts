/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ `/ __ `/ __ `/ /|/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/ /_/\____/_/   \__, /
                     /____/
*
*  cavira oss (c) 2026  -  nullure (c) 2026
*  ----------------------------------------------------------
*  file  : src/cli/commands/tokens/list.ts
*  usage : lists control-plane tokens without their secrets
*/

import type { cli_command } from '../../context/cli_context.js';
import { command_flags, flag, with_control } from '../../context/cli_context.js';
import { badge } from '../../theme/badges.js';
import { empty_state } from '../../output/empty_state.js';
import { emit } from '../../output/pretty.js';
import { table } from '../../output/table.js';

const status_of = (token: { revoked_at: number | null; expires_at: number | null }, now: number) =>
    token.revoked_at !== null ? 'REVOKED' : token.expires_at !== null && now >= token.expires_at ? 'EXPIRED' : 'ACTIVE';

export const tokens_list_command: cli_command = async (context) => {
    command_flags(context, []);
    const user_id = flag(context, 'user');
    const tokens = await with_control(context, (db) => db.list_tokens(user_id));
    const result = { ok: true, ...(user_id ? { user_id } : {}), tokens };
    const now = Date.now();
    emit(context, result, () => tokens.length ? table(tokens.map((token) => {
        const status = status_of(token, now);
        return {
            status: badge(status, status === 'ACTIVE', context.colors),
            id: token.id,
            user: token.user_id,
            label: token.label,
            space: token.default_space ?? 'personal',
            created: new Date(token.created_at).toISOString().slice(0, 10),
        };
    }), [
        { key: 'status', label: 'STATUS', width: 10 },
        { key: 'id', label: 'TOKEN ID', width: 13 },
        { key: 'user', label: 'USER', min: 8 },
        { key: 'label', label: 'LABEL', min: 10 },
        { key: 'space', label: 'SPACE', min: 9 },
        { key: 'created', label: 'CREATED', width: 10 },
    ], context.colors, context.terminal_width) : empty_state('tokens', context.colors, context.terminal_width));
};
