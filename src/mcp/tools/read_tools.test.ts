/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ `/ __ `/ __ `/ /|_/ / _ / __ `__ / __ / ___/ / / /
*   / /___/ /_/ / / / /_/ / / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/ /____/_/   \__, /
*                      /____/                                 /____/
*
*  cavira oss (c) 2022  -  nullure (c) 2026
*  ----------------------------------------------------------
*  file  : src/mcp/tools/read_tools.test.ts
*  usage : verifies read tools stay space-aware and never create projects from reads
*/

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { create_space_catalog, type catalog_identity } from '../../control/space_catalog.js';
import { control_db } from '../../control/control_db.js';
import { mcp_runtime } from '../runtime.js';
import { register_recall_tool } from './recall.js';
import { register_project_context_tool } from './project_context.js';
import { register_match_skills_tool } from './match_skills.js';
import { register_asset_catalog_tool } from './asset_catalog.js';
import { register_code_graph_tool } from './code_graph.js';
import { register_report_conflicts_tool } from './report_conflicts.js';

type captured = { name: string; handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> };

const capture_server = () => {
    const tools: captured[] = [];
    const server = {
        registerTool(name: string, _config: unknown, handler: captured['handler']) {
            tools.push({ name, handler });
        },
    };
    return { server: server as any, tools };
};

const fixture = () => {
    const directory = mkdtempSync(join(tmpdir(), 'longmemory-read-tools-'));
    const db = new control_db(join(directory, 'control.db'));
    db.create_user({ id: 'alice', display_name: 'Alice' });
    db.create_team({ id: 'core', name: 'Core' });
    db.create_team({ id: 'readers', name: 'Readers' });
    db.add_member('core', 'alice', 'admin');
    db.add_member('readers', 'alice', 'viewer');
    const alice_token = db.create_token({ user_id: 'alice', label: 'alice-read' }).token;
    const catalog = create_space_catalog({ db_path: join(directory, 'memory.db'), tenant_id: 'default', control: db, memory: {} });
    const auth = catalog.authenticate_token(alice_token);
    if (!auth.ok) throw new Error(`authentication failed: ${auth.code}`);
    const identity: catalog_identity = auth.identity;
    return {
        catalog, identity,
        runtime: (space_id?: string, space_explicit = false) => new mcp_runtime({
            catalog, identity, tenant_id: 'default',
            ...(space_id ? { space_id } : {}),
            space_explicit,
        }),
        close: async () => {
            await catalog.close();
            db.close();
            rmSync(directory, { recursive: true, force: true });
        },
    };
};

const parse = (result: { content: Array<{ text: string }> }): any => JSON.parse(result.content[0].text);

test('recall with space all tags each space and reports missing projects', async () => {
    const f = fixture();
    const runtime = f.runtime();
    const { server, tools } = capture_server();
    register_recall_tool(server, runtime);
    const handler = tools.find((tool) => tool.name === 'longmemory_recall')!.handler;

    const result = parse(await handler({ query: 'deploy', mode: 'historical', space: 'all', token_budget: 256 }));
    assert.equal(result.space, 'all');
    assert.deepEqual(result.spaces.map((entry: any) => entry.space), ['personal', 'team:core', 'team:readers']);
    assert.ok(result.spaces.every((entry: any) => entry.project_missing === true));

    const worlds = await runtime.memory.listWorlds();
    assert.equal(worlds.filter((world) => world.metadata.hierarchy === 'project').length, 0);
    await f.close();
});

test('single-space recall includes space and space_label', async () => {
    const f = fixture();
    const runtime = f.runtime();
    const { server, tools } = capture_server();
    register_recall_tool(server, runtime);
    const handler = tools.find((tool) => tool.name === 'longmemory_recall')!.handler;

    const result = parse(await handler({ query: 'deploy', mode: 'historical', space: 'team:core', token_budget: 256 }));
    assert.equal(result.space, 'team:core');
    assert.equal(result.space_label, 'Core');
    assert.equal(result.project_missing, true);
    await f.close();
});

test('project_context on a missing project returns project_missing and creates no worlds', async () => {
    const f = fixture();
    const runtime = f.runtime();
    const { server, tools } = capture_server();
    register_project_context_tool(server, runtime);
    const handler = tools.find((tool) => tool.name === 'longmemory_project_context')!.handler;

    const result = parse(await handler({ task: 'ship it', mode: 'coding', space: 'personal', token_budget: 256 }));
    assert.equal(result.project_missing, true);
    assert.equal(result.space, 'personal');
    assert.deepEqual(result.open_tasks, []);
    assert.equal((await runtime.memory.listWorlds()).filter((world) => world.metadata.hierarchy === 'project').length, 0);
    await f.close();
});

test('project_context with space all reports every space without creating worlds', async () => {
    const f = fixture();
    const runtime = f.runtime();
    const { server, tools } = capture_server();
    register_project_context_tool(server, runtime);
    const handler = tools.find((tool) => tool.name === 'longmemory_project_context')!.handler;

    const result = parse(await handler({ task: 'ship it', mode: 'coding', space: 'all', token_budget: 256 }));
    assert.equal(result.space, 'all');
    assert.deepEqual(result.spaces.map((entry: any) => entry.space), ['personal', 'team:core', 'team:readers']);
    assert.ok(result.spaces.every((entry: any) => entry.project_missing === true));
    assert.equal((await runtime.memory.listWorlds()).filter((world) => world.metadata.hierarchy === 'project').length, 0);
    await f.close();
});

test('match_skills, asset_catalog, code_graph, and report_conflicts return empty shapes on a missing project', async () => {
    const f = fixture();
    const runtime = f.runtime();
    const { server, tools } = capture_server();
    register_match_skills_tool(server, runtime);
    register_asset_catalog_tool(server, runtime);
    register_code_graph_tool(server, runtime);
    register_report_conflicts_tool(server, runtime);

    const call = async (name: string, input: Record<string, unknown>) =>
        parse(await tools.find((tool) => tool.name === name)!.handler(input));

    const skills = await call('longmemory_match_skills', { query: 'deploy', space: 'personal' });
    assert.equal(skills.project_missing, true);
    assert.deepEqual(skills.matches, []);

    const assets = await call('longmemory_asset_catalog', { action: 'list', space: 'personal' });
    assert.equal(assets.project_missing, true);
    assert.deepEqual(assets.assets, []);

    const symbols = await call('longmemory_code_graph', { action: 'search', query: 'main', space: 'personal' });
    assert.equal(symbols.project_missing, true);
    assert.deepEqual(symbols.symbols, []);

    const conflicts = await call('longmemory_report_conflicts', { space: 'personal' });
    assert.equal(conflicts.project_missing, true);
    assert.deepEqual(conflicts.conflicts, []);
    assert.equal(conflicts.count, 0);

    assert.equal((await runtime.memory.listWorlds()).filter((world) => world.metadata.hierarchy === 'project').length, 0);
    await f.close();
});

test('project_context resolves an omitted or current project id to the cwd project', async () => {
    const f = fixture();
    const runtime = f.runtime();
    const cwd_project = runtime.resolve_project_id();
    await runtime.project(cwd_project);
    const { server, tools } = capture_server();
    register_project_context_tool(server, runtime);
    const handler = tools.find((tool) => tool.name === 'longmemory_project_context')!.handler;

    for (const input of [{}, { project_id: 'current' }]) {
        const result = parse(await handler({ ...input, task: 'ship it', mode: 'coding', space: 'personal', token_budget: 256 }));
        assert.equal(result.project_id, cwd_project);
        assert.equal(result.project_missing, undefined);
        assert.equal(result.ok, true);
    }
    await f.close();
});

test('project_context with space all returns a full view per space and splits the budget', async () => {
    const f = fixture();
    const runtime = f.runtime();
    await runtime.project('release');
    await runtime.for_space('team:core').project('release');
    const { server, tools } = capture_server();
    register_project_context_tool(server, runtime);
    const handler = tools.find((tool) => tool.name === 'longmemory_project_context')!.handler;

    const result = parse(await handler({ project_id: 'release', task: 'ship it', mode: 'coding', space: 'all', token_budget: 2048 }));
    assert.equal(result.space, 'all');
    assert.equal(result.spaces.length, 3);
    const [personal, core, readers] = result.spaces;
    for (const entry of [personal, core]) {
        assert.equal(entry.ok, true);
        assert.equal(entry.schema, 'longmemory.project-context.v1');
        assert.equal(entry.project_id, 'release');
        assert.equal(entry.task, 'coding: ship it');
        assert.equal(entry.project_missing, undefined);
        assert.equal(entry.debug_trace.mode, 'coding');
        assert.equal(typeof entry.debug_trace.cwd, 'string');
        // 2048 split three ways, not the whole budget spent per space.
        assert.equal(entry.debug_trace.token_budget, 682);
    }
    assert.equal(personal.space, 'personal');
    assert.equal(core.space, 'team:core');
    assert.equal(readers.space, 'team:readers');
    assert.equal(readers.project_missing, true);
    assert.equal(readers.project_id, 'release');
    await f.close();
});

test('a viewer can call every read tool without writing', async () => {
    const f = fixture();
    const runtime = f.runtime();
    const { server, tools } = capture_server();
    register_recall_tool(server, runtime);
    register_project_context_tool(server, runtime);
    register_match_skills_tool(server, runtime);
    register_asset_catalog_tool(server, runtime);
    register_code_graph_tool(server, runtime);
    register_report_conflicts_tool(server, runtime);

    const viewer = runtime.for_space('team:readers');
    assert.equal(viewer.access.read_only, true);
    const call = async (name: string, input: Record<string, unknown>) =>
        parse(await tools.find((tool) => tool.name === name)!.handler(input));

    const results = [
        await call('longmemory_recall', { query: 'deploy', mode: 'historical', space: 'team:readers' }),
        await call('longmemory_project_context', { task: 'ship', mode: 'coding', space: 'team:readers' }),
        await call('longmemory_match_skills', { query: 'deploy', space: 'team:readers' }),
        await call('longmemory_asset_catalog', { action: 'list', space: 'team:readers' }),
        await call('longmemory_code_graph', { action: 'search', query: 'main', space: 'team:readers' }),
        await call('longmemory_report_conflicts', { space: 'team:readers' }),
    ];
    assert.ok(results.every((result) => result.project_missing === true));
    assert.equal((await runtime.memory.listWorlds()).filter((world) => world.metadata.hierarchy === 'project').length, 0);
    await f.close();
});