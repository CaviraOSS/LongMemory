/*
 *      __                      __  ___
 *     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
 *    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
 *   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 *  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
 *                      /____/                                 /____/
 *
 *  cavira oss (c) 2026  -  nullure (c) 2026
 *  ----------------------------------------------------------
 *  file  : src/mcp/tools/identity.ts
 *  usage : pure view functions for identity and space discovery
 */

import type { mcp_runtime } from '../runtime.js';
import type { space_descriptor } from '../../control/space_catalog.js';

export type who_am_i_result = {
    user_id: string;
    display_name: string;
    tenant_id: string;
    auth_mode: 'token' | 'legacy';
    write_space: space_descriptor;
    spaces: readonly space_descriptor[];
    read_only: boolean;
    tool_prefix: null;
};

export type list_spaces_result = {
    spaces: readonly space_descriptor[];
};

export const who_am_i_view = (runtime: mcp_runtime): who_am_i_result => ({
    user_id: runtime.identity.user_id,
    display_name: runtime.identity.display_name,
    tenant_id: runtime.tenant_id,
    auth_mode: runtime.identity.auth,
    // `write_scope()` rejects read-only spaces so callers cannot write through it. Identity
    // inspection must still work for viewers and for an `all` read header, so report the
    // request's resolved space instead of asking the write path.
    write_space: runtime.space,
    spaces: runtime.spaces,
    read_only: runtime.access.read_only,
    tool_prefix: null,
});

export const list_spaces_view = (runtime: mcp_runtime): list_spaces_result => ({
    spaces: runtime.spaces,
});