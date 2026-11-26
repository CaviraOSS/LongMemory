import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
    CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema,
    ListResourceTemplatesRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema,
    PromptListChangedNotificationSchema, ReadResourceRequestSchema,
    ResourceListChangedNotificationSchema, ToolListChangedNotificationSchema,
    type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
    create_remote_mcp_proxy, inject_tool_arguments, resolve_proxy_project_id,
} from './remote_proxy.js';

const start_fake = async (options: { reject?: boolean; status?: number; tool_args?: Array<Record<string, unknown>>; authorization?: Array<string | undefined>; space?: Array<string | undefined> }) => {
    const server = new Server({ name: 'fake', version: '0.0.0' }, { capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [{
            name: 'longmemory_recall',
            description: 'recall',
            inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, space: { type: 'string' }, query: { type: 'string' } } },
        }],
    }));
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: [{
            uri: 'memory://personal',
            name: 'personal memory',
            description: 'Personal memory store',
        }],
    }));
    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
        resourceTemplates: [{
            uriTemplate: 'memory://{scope}',
            name: 'Memory resources',
            description: 'Memory resources per scope',
        }],
    }));
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        return { contents: [{ uri: request.params.uri, text: 'personal memory content' }] };
    });
    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
        prompts: [{
            name: 'recall',
            description: 'Recall memory',
        }],
    }));
    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        return { messages: [{ role: 'user', content: { type: 'text', text: 'recall ' + request.params.arguments?.query } }] };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        options.tool_args?.push(request.params.arguments ?? {});
        return { content: [{ type: 'text', text: 'ok' }] };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    await server.connect(transport);
    const http = createServer((request, response) => {
        options.authorization?.push(request.headers.authorization);
        options.space?.push(request.headers['x-longmemory-space'] as string | undefined);
        if (options.reject) {
            response.statusCode = 401;
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'unauthorized' }, id: null }));
            return;
        }
        if (options.status) {
            response.statusCode = options.status;
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'boom' }, id: null }));
            return;
        }
        void transport.handleRequest(request, response);
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address() as { port: number };
    return {
        server,
        url: `http://127.0.0.1:${address.port}`,
        close: async () => { await server.close(); await new Promise<void>((resolve) => http.close(() => resolve())); },
    };
};

const attach_local_client = async (proxy: Awaited<ReturnType<typeof create_remote_mcp_proxy>>) => {
    const [server_side, client_side] = InMemoryTransport.createLinkedPair();
    await proxy.server.connect(server_side);
    const client = new Client({ name: 'local', version: '0.0.0' });
    await client.connect(client_side);
    return client;
};

test('injects only declared, omitted arguments and never overrides explicit values', () => {
    const tool = { name: 't', inputSchema: { type: 'object' as const, properties: { project_id: { type: 'string' }, space: { type: 'string' }, query: { type: 'string' } } } };
    assert.deepEqual(inject_tool_arguments(tool, { query: 'deploy' }, { project_id: 'p', space: 'personal' }), { query: 'deploy', project_id: 'p', space: 'personal' });
    assert.deepEqual(inject_tool_arguments(tool, { query: 'deploy', space: 'all' }, { project_id: 'p', space: 'personal' }), { query: 'deploy', space: 'all', project_id: 'p' });
    assert.deepEqual(inject_tool_arguments(tool, { space: null }, { space: 'personal' }), { space: null });
    assert.deepEqual(inject_tool_arguments({ name: 't', inputSchema: { type: 'object' } }, {}, { space: 'personal' }), {});
});

test('resolves project ids from flag, env, config, then cwd', () => {
    assert.equal(resolve_proxy_project_id({ flag_project_id: 'flag', env: { LONGMEMORY_PROJECT_ID: 'env' }, config_project_id: 'config', cwd: '/work/My Repo' }), 'flag');
    assert.equal(resolve_proxy_project_id({ flag_project_id: undefined, env: { LONGMEMORY_PROJECT_ID: 'env' }, config_project_id: 'config', cwd: '/work/My Repo' }), 'env');
    assert.equal(resolve_proxy_project_id({ flag_project_id: undefined, env: {}, config_project_id: 'config', cwd: '/work/My Repo' }), 'config');
    assert.equal(resolve_proxy_project_id({ flag_project_id: undefined, env: { LONGMEMORY_PROJECT_ID: 'current' }, config_project_id: 'config', cwd: '/work/My Repo' }), 'my-repo');
});

test('sends the bearer token, omits the space header when null, and forwards tools', async () => {
    const authorization: Array<string | undefined> = [];
    const space: Array<string | undefined> = [];
    const fake = await start_fake({ authorization, space });
    try {
        const proxy = await create_remote_mcp_proxy({ server_url: fake.url, token: 'lm_abcdefghijkl_secret', space: null, project_id: 'p', cwd: '/work/p' });
        try {
            const client = await attach_local_client(proxy);
            const tools = await client.listTools();
            assert.equal(tools.tools[0].name, 'longmemory_recall');
            assert.equal(authorization[0], 'Bearer lm_abcdefghijkl_secret');
            assert.equal(space.every((value) => value === undefined), true);
            await client.close();
        } finally {
            await proxy.close();
        }
    } finally {
        await fake.close();
    }
});

test('sends the space header when configured and keeps explicit arguments', async () => {
    const tool_args: Array<Record<string, unknown>> = [];
    const space: Array<string | undefined> = [];
    const fake = await start_fake({ tool_args, space });
    try {
        const proxy = await create_remote_mcp_proxy({ server_url: fake.url, token: 'lm_abcdefghijkl_secret', space: 'team:core', project_id: 'injected', cwd: '/work/p' });
        try {
            const client = await attach_local_client(proxy);
            await client.callTool({ name: 'longmemory_recall', arguments: { query: 'deploy' } });
            await client.callTool({ name: 'longmemory_recall', arguments: { query: 'deploy', space: 'all', project_id: 'explicit' } });
            assert.deepEqual(tool_args[0], { query: 'deploy', project_id: 'injected', space: 'team:core' });
            assert.deepEqual(tool_args[1], { query: 'deploy', space: 'all', project_id: 'explicit' });
            assert.equal(space[0], 'team:core');
            await client.close();
        } finally {
            await proxy.close();
        }
    } finally {
        await fake.close();
    }
});

test('maps a 401 to authentication_failed without retrying', async () => {
    const fake = await start_fake({ reject: true });
    try {
        await assert.rejects(
            create_remote_mcp_proxy({ server_url: fake.url, token: 'lm_abcdefghijkl_secret', space: null, project_id: 'p', cwd: '/work/p' }),
            (error: unknown) => error instanceof Error && 'code' in error && (error as { code: string }).code === 'authentication_failed',
        );
    } finally {
        await fake.close();
    }
});

test('maps a non-401 HTTP status to server_error, not unreachable', async () => {
    const fake = await start_fake({ status: 500 });
    try {
        await assert.rejects(
            create_remote_mcp_proxy({ server_url: fake.url, token: 'lm_abcdefghijkl_secret', space: null, project_id: 'p', cwd: '/work/p' }),
            (error: unknown) => error instanceof Error && 'code' in error && (error as { code: string }).code === 'server_error',
        );
    } finally {
        await fake.close();
    }
});

test('forwards tool list changed notifications', async () => {
    const fake = await start_fake({});
    try {
        const proxy = await create_remote_mcp_proxy({ server_url: fake.url, token: 'lm_abcdefghijkl_secret', space: null, project_id: 'p', cwd: '/work/p' });
        try {
            const client = await attach_local_client(proxy);
            const changed = new Promise<void>((resolve) => {
                client.setNotificationHandler(ToolListChangedNotificationSchema, () => resolve());
            });
            // The remote transport opens its standalone SSE stream after initialize;
            // notifications sent before that are dropped, so keep notifying until one lands.
            for (let attempt = 0; attempt < 100; attempt++) {
                await fake.server.sendToolListChanged();
                const landed = await Promise.race([
                    changed.then(() => true),
                    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 25)),
                ]);
                if (landed) break;
            }
            await changed;
            await client.close();
        } finally {
            await proxy.close();
        }
    } finally {
        await fake.close();
    }
});

test('forwards resources, prompts, and list-changed notifications', async () => {
    const tool_args: Array<Record<string, unknown>> = [];
    const fake = await start_fake({ tool_args });
    try {
        const proxy = await create_remote_mcp_proxy({ server_url: fake.url, token: 'lm_abcdefghijkl_secret', space: 'personal', project_id: 'p', cwd: '/work/p' });
        try {
            const client = await attach_local_client(proxy);

            // Test resources
            const resources = await client.listResources();
            assert.equal(resources.resources.length, 1);
            assert.equal(resources.resources[0].name, 'personal memory');

            const templates = await client.listResourceTemplates();
            assert.equal(templates.resourceTemplates.length, 1);

            const readResult = await client.readResource({ uri: 'memory://personal' });
            assert.equal(readResult.contents.length, 1);
            const [content] = readResult.contents;
            assert.equal('text' in content ? content.text : undefined, 'personal memory content');

            // Test prompts
            const prompts = await client.listPrompts();
            assert.equal(prompts.prompts.length, 1);
            assert.equal(prompts.prompts[0].name, 'recall');

            const promptResult = await client.getPrompt({ name: 'recall', arguments: { query: 'test' } });
            assert.equal(promptResult.messages.length, 1);
            assert.equal(promptResult.messages[0].content.type, 'text');

            // Test notification forwarding
            const changed = new Promise<void>((resolve) => {
                client.setNotificationHandler(ResourceListChangedNotificationSchema, () => resolve());
            });
            await fake.server.sendResourceListChanged();
            await changed;

            const promptChanged = new Promise<void>((resolve) => {
                client.setNotificationHandler(PromptListChangedNotificationSchema, () => resolve());
            });
            await fake.server.sendPromptListChanged();
            await promptChanged;

            await client.close();
        } finally {
            await proxy.close();
        }
    } finally {
        await fake.close();
    }
});