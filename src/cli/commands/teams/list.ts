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
*  file  : src/cli/commands/teams/list.ts
*  usage : lists control-plane teams
*/

import type { cli_command } from '../../context/cli_context.js';
import { command_flags, with_control } from '../../context/cli_context.js';
import { badge } from '../../theme/badges.js';
import { empty_state } from '../../output/empty_state.js';
import { emit } from '../../output/pretty.js';
import { table } from '../../output/table.js';

export const teams_list_command: cli_command = async (context) => {
    command_flags(context, []);
    const teams = await with_control(context, (db) => db.list_teams());
    const result = { ok: true, teams };
    emit(context, result, () => teams.length ? table(teams.map((team) => ({
        status: badge(team.disabled_at === null ? 'ACTIVE' : 'DISABLED', team.disabled_at === null, context.colors),
        team: team.id,
        name: team.name,
        space: `team:${team.id}`,
    })), [
        { key: 'status', label: 'STATUS', width: 10 },
        { key: 'team', label: 'TEAM', min: 10 },
        { key: 'name', label: 'NAME', min: 10 },
        { key: 'space', label: 'SPACE', min: 12 },
    ], context.colors, context.terminal_width) : empty_state('teams', context.colors, context.terminal_width));
};
