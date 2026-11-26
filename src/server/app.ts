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
 *  file  : src/server/app.ts
 *  usage : implements the LongMemory app component
 */


import { createServer, type IncomingMessage, type RequestListener, type Server } from 'node:http';
import { createMemory, type long_memory } from '../core/create_memory.js';
import { create_space_catalog, type catalog_identity, type space_catalog } from '../control/space_catalog.js';
import { control_db } from '../control/control_db.js';
import { mcp_runtime } from '../mcp/runtime.js';
import { load_server_config, type server_config } from './config.js';
import { authenticate } from './middleware/auth.js';
import { api_error, clean_error } from './middleware/errors.js';
import { attach_timing, elapsed_ms } from './middleware/timing.js';
import { entities_route } from './routes/entities.js';
import { explain_route } from './routes/explain.js';
import { health_route } from './routes/health.js';
import { ingest_route } from './routes/ingest.js';
import { recall_route } from './routes/recall.js';
import { stats_route } from './routes/stats.js';
import { timeline_route } from './routes/timeline.js';
import { worlds_list_route, worlds_route } from './routes/worlds.js';
import { runtime_route } from './routes/runtime.js';
import { whoami_route } from './routes/whoami.js';
import { apply_cors } from './middleware/cors.js';
import { fixed_window_rate_limiter } from './middleware/rate_limit.js';
import { local_runtime_metrics } from './middleware/telemetry.js';
import { concurrency_limiter } from './middleware/concurrency.js';
import { project_context_route } from './routes/project_context.js';

export type route_context = {
    memory: long_memory;
    config: server_config;
    request: IncomingMessage;
    params: Record<string, string>;
    query: URLSearchParams;
    body: unknown;
    metrics: local_runtime_metrics;
    identity: catalog_identity;
    catalog: space_catalog;
    runtime: mcp_runtime;
    space_explicit: boolean;
    header_space: string | null;
};

export type route_result = { status?: number; data: unknown };
export type route_handler = (context: route_context) => Promise<route_result>;
type route = { method: string; match(path: string): Record<string, string> | null; handler: route_handler };
export type server_options = { config?: server_config; memory?: long_memory };
export type long_memory_app = {
    handler: RequestListener;
    memory: long_memory;
    config: server_config;
    metrics: local_runtime_metrics;
    catalog: space_catalog;
    close(): Promise<void>;
};

const exact = (path: string) => (input: string) => input === path ? {} : null;
const identified = (base: string) => (input: string) => {
    const match = input.match(new RegExp(`^${base}/([^/]+)$`));
    return match ? { id: decodeURIComponent(match[1]) } : null;
};

const routes: route[] = [
    { method: 'GET', match: exact('/health'), handler: health_route },
    { method: 'GET', match: exact('/v1/whoami'), handler: whoami_route },
    { method: 'POST', match: exact('/v1/ingest'), handler: ingest_route },
    { method: 'POST', match: exact('/v1/recall'), handler: recall_route },
    { method: 'POST', match: exact('/v1/project/context'), handler: project_context_route },
    { method: 'GET', match: identified('/v1/explain'), handler: explain_route },
    { method: 'GET', match: exact('/v1/worlds'), handler: worlds_list_route },
    { method: 'GET', match: identified('/v1/worlds'), handler: worlds_route },
    { method: 'GET', match: identified('/v1/entities'), handler: entities_route },
    { method: 'GET', match: exact('/v1/timeline'), handler: timeline_route },
    { method: 'GET', match: exact('/v1/stats'), handler: stats_route },
    { method: 'GET', match: exact('/v1/runtime'), handler: runtime_route },
];

const read_body = async (request: IncomingMessage, max_payload_size: number): Promise<unknown> => {
    if (request.method === 'GET' || request.method === 'HEAD') return null;
    const kind = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
    if (kind !== 'application/json') throw new api_error(415, 'unsupported_media_type', 'Content-Type must be application/json');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += part.length;
        if (size > max_payload_size) throw new api_error(413, 'payload_too_large', `Request body exceeds ${max_payload_size} bytes`);
        chunks.push(part);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
        throw new api_error(400, 'invalid_json', 'Request body must contain valid JSON');
    }
};

const write = (response: Parameters<RequestListener>[1], status: number, payload: unknown, started_at: number) => {
    const duration_ms = elapsed_ms(started_at);
    attach_timing(response, duration_ms);
    response.statusCode = status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(payload));
};

const header_space = (request: IncomingMessage): string | null => {
    const value = request.headers['x-longmemory-space'];
    const raw = Array.isArray(value) ? value[0] : value;
    return raw?.trim() ? raw.trim() : null;
};

export function create_long_memory_app(options: server_options = {}): long_memory_app {
    const config = options.config ?? load_server_config();
    const memory = options.memory ?? createMemory(config.memory);
    const owns_memory = options.memory === undefined;
    const control = config.control_db_path ? new control_db(config.control_db_path) : null;
    const { store: _store, db_path: _db_path, tenant_id: _tenant_id, user_id: _user_id, readonly: _readonly, ...memory_options } = config.memory;
    const catalog = create_space_catalog({
        db_path: config.memory.db_path,
        tenant_id: config.memory.tenant_id ?? 'default',
        readonly: config.memory.readonly === true,
        control,
        memory: memory_options,
        ...(control ? {} : { legacy: { user_id: config.memory.user_id ?? 'default', memory } }),
    });
    const metrics = new local_runtime_metrics(config.telemetry);
    const rate_limiter = new fixed_window_rate_limiter(config.rate_limit);
    const concurrency = new concurrency_limiter(config.max_active_requests);
    let mcp_modules: Promise<[typeof import('../mcp/transports/http.js'), typeof import('../mcp/runtime.js')]> | null = null;
    const load_mcp = () => mcp_modules ??= Promise.all([
        import('../mcp/transports/http.js'),
        import('../mcp/runtime.js'),
    ]);
    let legacy_mcp: Promise<{ handler: RequestListener }> | null = null;
    const mcp_handler = async (runtime: mcp_runtime) => {
        const [transport] = await load_mcp();
        // A control-mode request has its own identity and space, so its handler must not be shared
        // across requests. Legacy mode has one identity, so the memoized handler stays valid.
        if (config.control_db_path) return transport.create_mcp_http_handler({ runtime });
        return legacy_mcp ??= load_mcp().then(([cached]) => cached.create_mcp_http_handler({ runtime }));
    };
    const runtime_for = (identity: catalog_identity, requested: string | null) => new mcp_runtime({
        catalog,
        identity,
        tenant_id: config.memory.tenant_id ?? 'default',
        ...(requested !== null && requested !== 'all' ? { space_id: requested } : {}),
        space_explicit: requested !== null,
        requested_space: requested,
        audit_path: `${config.memory.db_path}.mcp-audit.jsonl`,
    });
    const handler: RequestListener = async (request, response) => {
        const started_at = performance.now();
        let route_path = '/';
        let release = () => { };
        try {
            const url = new URL(request.url ?? '/', 'http://longmemory.local');
            route_path = url.pathname;
            if (apply_cors(request, response, config.allowed_origins)) return;
            if (url.pathname.startsWith('/v1/') || url.pathname === '/mcp') {
                rate_limiter.check(request, response);
                release = concurrency.enter();
            }
            const requested = header_space(request);
            const secured = url.pathname.startsWith('/v1/') || (url.pathname === '/mcp' && config.mcp_http);
            const identity = secured ? await authenticate(request, config, catalog) : catalog.legacy_identity();
            if (secured && config.log_auth) console.info(`[longmemory] authorized ${request.method} ${url.pathname} from ${request.socket.remoteAddress ?? 'unknown'}`);
            const runtime = runtime_for(identity, requested);
            if (url.pathname === '/mcp' && config.mcp_http) {
                const mcp = await mcp_handler(runtime);
                await mcp.handler(request, response);
                metrics.observe('/mcp', response.statusCode, elapsed_ms(started_at));
                release();
                return;
            }
            const matches = routes.map((item) => ({ item, params: item.match(url.pathname) })).filter((item) => item.params !== null);
            if (!matches.length) throw new api_error(404, 'not_found', 'Route not found');
            const selected = matches.find(({ item }) => item.method === request.method);
            if (!selected) {
                response.setHeader('allow', matches.map(({ item }) => item.method).join(', '));
                throw new api_error(405, 'method_not_allowed', 'Method not allowed');
            }
            const body = await read_body(request, config.max_payload_size);
            const result = await selected.item.handler({
                memory: runtime.memory,
                config,
                request,
                params: selected.params!,
                query: url.searchParams,
                body,
                metrics,
                identity,
                catalog,
                runtime,
                space_explicit: requested !== null,
                header_space: requested,
            });
            const duration_ms = elapsed_ms(started_at);
            attach_timing(response, duration_ms);
            response.statusCode = result.status ?? 200;
            response.setHeader('content-type', 'application/json; charset=utf-8');
            response.end(JSON.stringify({ data: result.data, meta: { duration_ms } }));
            metrics.observe(route_path, response.statusCode, duration_ms);
            release();
        } catch (error) {
            const clean = clean_error(error);
            const duration_ms = elapsed_ms(started_at);
            if (clean.status === 401) response.setHeader('www-authenticate', 'Bearer');
            write(response, clean.status, { error: clean.body, meta: { duration_ms } }, started_at);
            metrics.observe(route_path, clean.status, duration_ms);
            release();
        }
    };
    const close = async () => {
        await catalog.close();
        if (owns_memory) await memory.close();
    };
    return { handler, memory, config, metrics, catalog, close };
}

export function create_long_memory_server(options: server_options = {}): Server {
    const app = create_long_memory_app(options);
    const server = createServer(app.handler);
    server.on('close', () => void app.close());
    return server;
}
