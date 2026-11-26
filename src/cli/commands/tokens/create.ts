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
*  file  : src/cli/commands/tokens/create.ts
*  usage : mints a control-plane bearer token
*/

import { write_token_file } from '../auth/common.js';
import type { cli_command } from '../../context/cli_context.js';
import { command_flags, flag, number_flag, require_value, with_control } from '../../context/cli_context.js';
import { cli_error, exit_codes } from '../../output/errors.js';
import { panel } from '../../output/panel.js';
import { emit } from '../../output/pretty.js';

export const tokens_create_command: cli_command = async (context) => {
    command_flags(context, ['label', 'space', 'expires', 'write']);
    const user_id = require_value(flag(context, 'user'), '--user');
    const label = require_value(flag(context, 'label'), '--label');
    const space = flag(context, 'space') ?? null;
    const days = number_flag(context, 'expires');
    if (days !== undefined && (!Number.isInteger(days) || days < 1)) {
        throw new cli_error('validation_error', '--expires must be a positive whole number of days', exit_codes.validation);
    }
    const expires_at = days === undefined ? null : Date.now() + days * 86_400_000;
    const issued = await with_control(context, (db) => db.create_token({ user_id, label, default_space: space, expires_at }));
    const write = flag(context, 'write');
    const token_file = write ? write_token_file(write, issued.token) : undefined;
    const { token, ...record } = issued;
    const result = {
        ok: true,
        ...record,
        ...(token_file ? { token_file } : { token }),
    };

    emit(context, result, () => [
        panel('', context.colors, {
            title: 'Token created', kind: 'success', width: context.terminal_width,
            rows: [
                ['Token ID', record.id],
                ['User', record.user_id],
                ['Label', record.label],
                ['Space', record.default_space ?? 'personal'],
                ['Expires', record.expires_at === null ? 'never' : new Date(record.expires_at).toISOString()],
            ],
        }),
        '',
        token_file
            ? `${context.colors.title('Token written to')}\n  ${context.colors.info(token_file)}`
            : `${context.colors.title('Token (shown once)')}\n  ${context.colors.info(token)}`,
    ].join('\n'));
};
