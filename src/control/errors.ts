/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/
*
*  cavira oss (c) 2026  -  nullure (c) 2026
*  ----------------------------------------------------------
*  file  : src/control/errors.ts
*  usage : defines control plane error codes and status mapping
*/

export type control_error_code =
    | 'validation_error'
    | 'not_found'
    | 'conflict'
    | 'unauthorized'
    | 'token_expired'
    | 'token_revoked'
    | 'invalid_space'
    | 'space_forbidden'
    | 'identity_mismatch'
    | 'project_not_found';

const statuses: Record<control_error_code, number> = {
    validation_error: 400,
    not_found: 404,
    conflict: 409,
    unauthorized: 401,
    token_expired: 401,
    token_revoked: 401,
    invalid_space: 400,
    space_forbidden: 403,
    identity_mismatch: 403,
    project_not_found: 404,
};

export class control_error extends Error {
    readonly status: number;

    constructor(readonly code: control_error_code, message: string) {
        super(message);
        this.name = 'control_error';
        this.status = statuses[code];
    }
}
