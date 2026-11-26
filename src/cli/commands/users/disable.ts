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
*  file  : src/cli/commands/users/disable.ts
*  usage : disables a control-plane user
*/

import type { cli_command } from '../../context/cli_context.js';
import { command_flags, flag, positional, require_value, with_control } from '../../context/cli_context.js';
import { panel } from '../../output/panel.js';
import { emit } from '../../output/pretty.js';

export const users_disable_command: cli_command = async (context) => {
    command_flags(context, ['id']);
    const id = require_value(flag(context, 'id') ?? positional(context), 'user id');
    const user = await with_control(context, (db) => db.disable_user(id));
    const result = { ok: true, user };
    emit(context, result, () => panel('', context.colors, {
        title: 'User disabled', kind: 'warning', width: context.terminal_width,
        rows: [['User', user.id], ['Name', user.display_name]],
    }));
};
