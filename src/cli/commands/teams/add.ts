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
*  file  : src/cli/commands/teams/add.ts
*  usage : adds a user to a control-plane team
*/

import type { cli_command } from '../../context/cli_context.js';
import { command_flags, flag, positional, require_value, with_control } from '../../context/cli_context.js';
import { panel } from '../../output/panel.js';
import { emit } from '../../output/pretty.js';

export const teams_add_command: cli_command = async (context) => {
    command_flags(context, ['team', 'role']);
    const team = require_value(positional(context, 0) ?? flag(context, 'team'), 'team');
    const user = require_value(positional(context, 1) ?? flag(context, 'user'), 'user');
    const role = flag(context, 'role') ?? 'member';
    const membership = await with_control(context, (db) => db.add_member(team, user, role as 'viewer' | 'member' | 'admin'));
    const result = { ok: true, membership };
    emit(context, result, () => panel('', context.colors, {
        title: 'Team member added', kind: 'success', width: context.terminal_width,
        rows: [['Team', membership.team_id], ['User', membership.user_id], ['Role', membership.role], ['Space', `team:${membership.team_id}`]],
    }));
};
