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
*  file  : src/cli/commands/teams/create.ts
*  usage : creates a control-plane team
*/

import type { cli_command } from '../../context/cli_context.js';
import { command_flags, flag, positional, require_value, with_control } from '../../context/cli_context.js';
import { panel } from '../../output/panel.js';
import { emit } from '../../output/pretty.js';

export const teams_create_command: cli_command = async (context) => {
    command_flags(context, ['id', 'name']);
    const id = require_value(flag(context, 'id') ?? positional(context), '--id');
    const team = await with_control(context, (db) => db.create_team({ id, name: flag(context, 'name') }));
    const result = { ok: true, team };
    emit(context, result, () => panel('', context.colors, {
        title: 'Team created', kind: 'success', width: context.terminal_width,
        rows: [['Team', team.id], ['Name', team.name]],
    }));
};
