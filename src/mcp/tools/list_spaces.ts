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
 *  file  : src/mcp/tools/list_spaces.ts
 *  usage : registers the longmemory_list_spaces tool
 */

import type { McpServer as mcp_server_sdk } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { mcp_runtime } from '../runtime.js';
import { run_audited_tool } from './common.js';
import { list_spaces_view } from './identity.js';

export function register_list_spaces_tool(server: mcp_server_sdk, runtime: mcp_runtime): void {
    server.registerTool('longmemory_list_spaces', {
        description: 'List every memory space the authenticated identity can access.',
        inputSchema: {},
        annotations: { readOnlyHint: true, idempotentHint: true },
    }, async (input) => run_audited_tool(runtime, 'longmemory_list_spaces', input ?? {}, async () => list_spaces_view(runtime)));
}