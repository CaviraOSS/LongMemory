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
*  file  : src/cli/commands/users/list.ts
*  usage : lists control-plane users
*/

import type { cli_command } from '../../context/cli_context.js';
import { command_flags, with_control } from '../../context/cli_context.js';
import { badge } from '../../theme/badges.js';
import { empty_state } from '../../output/empty_state.js';
import { emit } from '../../output/pretty.js';
import { table } from '../../output/table.js';

export const users_list_command: cli_command = async (context) => {
    command_flags(context, []);
    const users = await with_control(context, (db) => db.list_users());
    const result = { ok: true, users };
    emit(context, result, () => users.length ? table(users.map((user) => ({
        status: badge(user.disabled_at === null ? 'ACTIVE' : 'DISABLED', user.disabled_at === null, context.colors),
        user: user.id,
        name: user.display_name,
        partition: user.personal_partition,
    })), [
        { key: 'status', label: 'STATUS', width: 10 },
        { key: 'user', label: 'USER', min: 10 },
        { key: 'name', label: 'NAME', min: 10 },
        { key: 'partition', label: 'PARTITION', min: 10 },
    ], context.colors, context.terminal_width) : empty_state('users', context.colors, context.terminal_width));
};
