/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ `/ __ `/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/
 *
 *  cavira oss (c) 2026  -  nullure (c) 2026
 *  ----------------------------------------------------------
 *  file  : src/server/routes/whoami.ts
 *  usage : reports the authenticated identity and accessible spaces
 */


import { who_am_i_view } from '../../mcp/tools/identity.js';
import type { route_handler } from '../app.js';

export const whoami_route: route_handler = async ({ runtime }) => ({ data: who_am_i_view(runtime) });
