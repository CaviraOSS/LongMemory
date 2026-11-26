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
*  file  : src/cli/commands/teams/remove.ts
*  usage : removes a user from a control-plane team
*/

import type { cli_command } from '../../context/cli_context.js';
import { command_flags, flag, positional, require_value, with_control } from '../../context/cli_context.js';
import { panel } from '../../output/panel.js';
import { emit } from '../../output/pretty.js';

export const teams_remove_command: cli_command = async (context) => {
    command_flags(context, ['team']);
    const team = require_value(positional(context, 0) ?? flag(context, 'team'), 'team');
    const user = require_value(positional(context, 1) ?? flag(context, 'user'), 'user');
    await with_control(context, (db) => db.remove_member(team, user));
    const result = { ok: true, team_id: team, user_id: user, removed: true };
    emit(context, result, () => panel('', context.colors, {
        title: 'Team member removed', kind: 'warning', width: context.terminal_width,
        rows: [['Team', team], ['User', user]],
    }));
};
