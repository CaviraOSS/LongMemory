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
*  file  : src/cli/commands/spaces/list.ts
*  usage : lists the memory spaces a control-plane user can access
*/

import type { cli_command } from '../../context/cli_context.js';
import { command_flags, flag, with_control } from '../../context/cli_context.js';
import type { control_space_record } from '../../../control/types.js';
import { empty_state } from '../../output/empty_state.js';
import { emit, section } from '../../output/pretty.js';
import { table } from '../../output/table.js';

const spaces_table = (spaces: readonly control_space_record[], context: Parameters<cli_command>[0]) => spaces.length
    ? table(spaces.map((space) => ({
        space: space.id,
        kind: space.kind,
        role: space.role,
        access: space.writable ? 'read/write' : 'read-only',
    })), [
        { key: 'space', label: 'SPACE', min: 12 },
        { key: 'kind', label: 'KIND', width: 9 },
        { key: 'role', label: 'ROLE', width: 8 },
        { key: 'access', label: 'ACCESS', width: 10 },
    ], context.colors, context.terminal_width)
    : empty_state('spaces', context.colors, context.terminal_width);

export const spaces_list_command: cli_command = async (context) => {
    command_flags(context, []);
    const user_id = flag(context, 'user');
    type spaces_result =
        | { ok: true; user_id: string; spaces: control_space_record[] }
        | { ok: true; users: Array<{ user_id: string; display_name: string; disabled: boolean; spaces: control_space_record[] }> };
    const result = await with_control<spaces_result>(context, (db) => {
        if (user_id) return { ok: true, user_id, spaces: db.spaces_for_user(user_id) };
        const users = db.list_users().map((user) => ({
            user_id: user.id,
            display_name: user.display_name,
            disabled: user.disabled_at !== null,
            spaces: user.disabled_at === null ? db.spaces_for_user(user.id) : [],
        }));
        return { ok: true, users };
    });

    emit(context, result, () => {
        if ('user_id' in result) return spaces_table(result.spaces, context);
        return result.users.map((user) => section(
            context,
            `${user.user_id}${user.disabled ? ' (disabled)' : ''}`,
            user.disabled ? context.colors.muted('Disabled users have no accessible spaces.') : spaces_table(user.spaces, context),
        )).join('\n\n');
    });
};
