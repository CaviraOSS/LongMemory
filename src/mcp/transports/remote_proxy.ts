/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / /_/ / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/____/_/   \__, /
*                      /____/                                 /____/
*
*  cavira oss (c) 2026  -  nullure (c) 2026
*  ----------------------------------------------------------
*  file  : src/mcp/transports/remote_proxy.ts
*  usage : proxies local stdio MCP to a remote LongMemory /mcp endpoint
*/


import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema,
    ListResourceTemplatesRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema,
    PromptListChangedNotificationSchema, ReadResourceRequestSchema,
    ResourceListChangedNotificationSchema, ToolListChangedNotificationSchema,
    type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { current_project_id } from '../runtime.js';

export type remote_proxy_config = {
    server_url: string;
    token: string;
    space: string | null;
    project_id: string;
    cwd?: string;
    client_name?: string;
    client_version?: string;
};

export type remote_proxy_error_code = 'authentication_failed' | 'server_unreachable' | 'server_error';

export class remote_proxy_error extends Error {
    constructor(readonly code: remote_proxy_error_code, message: string) {
        super(message);
        this.name = 'remote_proxy_error';
    }
}

const proxy_server_url = (value: string): string => {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new remote_proxy_error('server_error', 'The server URL is not a valid URL');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new remote_proxy_error('server_error', 'The server URL must use http or https');
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new remote_proxy_error('server_error', 'The server URL must not include credentials, a query, or a hash');
    }
    return `${url.origin}${url.pathname}`.replace(/\/$/, '').replace(/\/mcp$/, '');
};

export const inject_tool_arguments = (
    tool: { name: string; inputSchema?: { type?: string; properties?: Record<string, unknown> } },
    args: Record<string, unknown>,
    defaults: Record<string, unknown>,
): Record<string, unknown> => {
    const properties = tool.inputSchema?.properties;
    if (!properties) return { ...args };
    const injected = { ...args };
    for (const [key, value] of Object.entries(defaults)) {
        if (value === undefined) continue;
        if (!Object.hasOwn(properties, key)) continue;
        if (injected[key] === undefined) injected[key] = value;
    }
    return injected;
};

export const resolve_proxy_project_id = (input: {
    flag_project_id?: string;
    env: NodeJS.ProcessEnv;
    config_project_id?: string | null;
    cwd: string;
}): string => {
    const flag = input.flag_project_id?.trim();
    if (flag) return flag === 'current' ? current_project_id(input.cwd) : flag;
    const env = input.env.LONGMEMORY_PROJECT_ID?.trim();
    if (env) return env === 'current' ? current_project_id(input.cwd) : env;
    const config = input.config_project_id?.trim();
    if (config) return config === 'current' ? current_project_id(input.cwd) : config;
    return current_project_id(input.cwd);
};

const is_authentication_error = (error: unknown): boolean => {
    if (error instanceof StreamableHTTPError) return error.code === 401;
    return (error as { code?: unknown } | null)?.code === 401;
};

const http_status = (error: unknown): number | null => {
    if (error instanceof StreamableHTTPError && typeof error.code === 'number') return error.code;
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'number' ? code : null;
};

export type remote_proxy = {
    server: Server;
    client: Client;
    close: () => Promise<void>;
};

export const create_remote_mcp_proxy = async (config: remote_proxy_config): Promise<remote_proxy> => {
    const base = proxy_server_url(config.server_url);
    const url = new URL(`${base}/mcp`);
    const headers: Record<string, string> = {
        authorization: `Bearer ${config.token}`,
    };
    if (config.space !== null) headers['x-longmemory-space'] = config.space;

    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers } });
    const client = new Client({
        name: config.client_name ?? 'longmemory-proxy',
        version: config.client_version ?? '0.0.0',
    });

    try {
        await client.connect(transport);
    } catch (error) {
        if (is_authentication_error(error)) {
            throw new remote_proxy_error('authentication_failed', 'The LongMemory server rejected the token');
        }
        const status = http_status(error);
        if (status !== null) {
            throw new remote_proxy_error('server_error', `LongMemory server returned ${status} for /mcp`);
        }
        throw new remote_proxy_error('server_unreachable', 'Could not reach the LongMemory server');
    }

    const capabilities = client.getServerCapabilities() ?? {};
    const server = new Server({ name: 'longmemory', version: '0.0.0' }, { capabilities });

    let cached_tools: Tool[] | null = null;
    const all_tools = async (): Promise<Tool[]> => {
        if (cached_tools) return cached_tools;
        const tools: Tool[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 100; page++) {
            const result = await client.listTools(cursor ? { cursor } : undefined);
            tools.push(...result.tools);
            cursor = result.nextCursor;
            if (!cursor) break;
        }
        cached_tools = tools;
        return tools;
    };

    if (capabilities.tools) {
        server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await all_tools() }));
        server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const tool = (await all_tools()).find((candidate) => candidate.name === request.params.name);
            if (!tool) return client.callTool(request.params);
            const args = inject_tool_arguments(
                tool,
                request.params.arguments ?? {},
                {
                    project_id: config.project_id,
                    space: config.space !== null ? config.space : undefined,
                },
            );
            return client.callTool({ ...request.params, arguments: args });
        });
    }

    if (capabilities.resources) {
        server.setRequestHandler(ListResourcesRequestSchema, async (request) => client.listResources(request.params));
        server.setRequestHandler(ListResourceTemplatesRequestSchema, async (request) => client.listResourceTemplates(request.params));
        server.setRequestHandler(ReadResourceRequestSchema, async (request) => client.readResource(request.params));
    }

    if (capabilities.prompts) {
        server.setRequestHandler(ListPromptsRequestSchema, async (request) => client.listPrompts(request.params));
        server.setRequestHandler(GetPromptRequestSchema, async (request) => client.getPrompt(request.params));
    }

    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        cached_tools = null;
        try {
            await server.sendToolListChanged();
        } catch {
            // A notification before the local transport connects has nowhere to go.
        }
    });
    client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
        try {
            await server.sendResourceListChanged();
        } catch {
            // A notification before the local transport connects has nowhere to go.
        }
    });
    client.setNotificationHandler(PromptListChangedNotificationSchema, async () => {
        try {
            await server.sendPromptListChanged();
        } catch {
            // A notification before the local transport connects has nowhere to go.
        }
    });

    return {
        server,
        client,
        close: async () => {
            await server.close().catch(() => {});
            await client.close().catch(() => {});
        },
    };
};

export const run_remote_mcp_proxy = async (config: remote_proxy_config): Promise<void> => {
    const proxy = await create_remote_mcp_proxy(config);
    const transport = new StdioServerTransport();
    await proxy.server.connect(transport);
    await new Promise<void>((resolve) => { transport.onclose = () => resolve(); });
    await proxy.close();
};
