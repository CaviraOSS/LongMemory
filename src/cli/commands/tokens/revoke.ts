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
*  file  : src/cli/commands/tokens/revoke.ts
*  usage : revokes a control-plane bearer token
*/

import type { cli_command } from '../../context/cli_context.js';
import { command_flags, positional, require_value, with_control } from '../../context/cli_context.js';
import { panel } from '../../output/panel.js';
import { emit } from '../../output/pretty.js';

export const tokens_revoke_command: cli_command = async (context) => {
    command_flags(context, []);
    const id = require_value(positional(context), 'token id');
    const token = await with_control(context, (db) => db.revoke_token(id));
    const result = { ok: true, token };
    emit(context, result, () => panel('', context.colors, {
        title: 'Token revoked', kind: 'warning', width: context.terminal_width,
        rows: [['Token ID', token.id], ['User', token.user_id], ['Label', token.label]],
    }));
};
