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
*  file  : src/control/types.ts
*  usage : defines control plane record types
*/

export type control_role = 'viewer' | 'member' | 'admin';

export type control_user = {
    id: string;
    display_name: string;
    personal_partition: string;
    created_at: number;
    disabled_at: number | null;
};

export type control_team = {
    id: string;
    name: string;
    created_at: number;
    disabled_at: number | null;
};

export type control_membership = {
    team_id: string;
    user_id: string;
    role: control_role;
    created_at: number;
};

export type control_token_record = {
    id: string;
    user_id: string;
    label: string;
    default_space: string | null;
    created_at: number;
    last_used_at: number | null;
    expires_at: number | null;
    revoked_at: number | null;
};

export type control_space_record = {
    id: string;
    kind: 'personal' | 'team';
    team_id: string | null;
    role: control_role | 'owner';
    writable: boolean;
};
