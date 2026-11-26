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
*  file  : src/cli/commands/auth/init.ts
*  usage : initializes the control plane and mints the first token
*/

import type { cli_command } from '../../context/cli_context.js';
import { command_flags, flag, has, require_value, with_control } from '../../context/cli_context.js';
import { cli_error, exit_codes } from '../../output/errors.js';
import { panel } from '../../output/panel.js';
import { emit } from '../../output/pretty.js';
import { memory_has_worlds, write_token_file } from './common.js';

export const auth_init_command: cli_command = async (context) => {
    command_flags(context, ['name', 'adopt-default', 'write-token']);
    const user_id = require_value(flag(context, 'user'), '--user');
    const adopt = has(context, 'adopt-default');
    const write_token = flag(context, 'write-token');
    const existing_data = !adopt && user_id !== 'default' ? await memory_has_worlds(context.db_path) : false;

    const outcome = await with_control(context, (db) => {
        const existing = db.get_user(user_id);
        if (existing_data && existing?.personal_partition !== 'default') {
            throw new cli_error(
                'adopt_default_required',
                `LongMemory already contains default data at ${context.db_path}; rerun with --adopt-default or use --user default`,
                exit_codes.validation,
                { user_id, db_path: context.db_path },
                'longmemory auth:init --user alice --adopt-default',
                `Rerun with --adopt-default to bind ${user_id} to the default partition, or use --user default.`,
            );
        }
        const created = existing === null;
        const bind_default = adopt && user_id !== 'default';
        let user = existing ?? db.create_user({
            id: user_id,
            display_name: flag(context, 'name'),
            ...(bind_default ? { personal_partition: 'default' } : {}),
        });
        if (existing && bind_default && user.personal_partition !== 'default') {
            user = db.set_personal_partition(user_id, 'default');
        }
        // The initial token exists to bootstrap a new user. Re-running must never print a fresh
        // secret or pile up tokens; operators mint additional tokens with `tokens:create`.
        const issued = created ? db.create_token({ user_id, label: 'initial' }) : null;
        return { user, created, issued };
    });

    const token_file = outcome.issued?.token && write_token ? write_token_file(write_token, outcome.issued.token) : undefined;
    const token = outcome.issued && !token_file ? outcome.issued.token : undefined;
    const control_db = context.control_db_path;
    const result = {
        ok: true,
        user: outcome.user,
        created: outcome.created,
        control_db,
        server_env: `LONGMEMORY_CONTROL_DB=${control_db}`,
        ...(token ? { token } : {}),
        ...(token_file ? { token_file } : {}),
    };

    emit(context, result, () => [
        panel('', context.colors, {
            title: outcome.created ? 'Control plane initialized' : 'Control plane already initialized',
            kind: outcome.created ? 'success' : 'info',
            width: context.terminal_width,
            rows: [
                ['User', outcome.user.id],
                ['Partition', outcome.user.personal_partition],
                ['Control DB', control_db],
            ],
        }),
        '',
        token ? `${context.colors.title('Token (shown once)')}\n  ${context.colors.info(token)}` : '',
        token_file ? `${context.colors.title('Token written to')}\n  ${context.colors.info(token_file)}` : '',
        outcome.created ? '' : context.colors.muted('User already existed; no token was created. Run `longmemory tokens:create --user <id> --label <label>` for a new token.'),
        '',
        `${context.colors.title('Server environment')}\n  LONGMEMORY_CONTROL_DB=${control_db}`,
    ].filter(Boolean).join('\n'));
};
