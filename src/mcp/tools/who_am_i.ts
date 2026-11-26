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
 *  file  : src/mcp/tools/who_am_i.ts
 *  usage : registers the longmemory_who_am_i tool
 */

import type { McpServer as mcp_server_sdk } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { mcp_runtime } from '../runtime.js';
import { run_audited_tool } from './common.js';
import { who_am_i_view } from './identity.js';

export function register_who_am_i_tool(server: mcp_server_sdk, runtime: mcp_runtime): void {
    server.registerTool('longmemory_who_am_i', {
        description: 'Report authenticated identity, write default space, and accessible spaces.',
        inputSchema: {},
        annotations: { readOnlyHint: true, idempotentHint: true },
    }, async (input) => run_audited_tool(runtime, 'longmemory_who_am_i', input ?? {}, async () => who_am_i_view(runtime)));
}