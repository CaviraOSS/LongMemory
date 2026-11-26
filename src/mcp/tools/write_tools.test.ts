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
*  file  : src/mcp/tools/write_tools.test.ts
*  usage : verifies write tools enforce writable spaces and token identity
*/

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { create_space_catalog, type catalog_identity } from '../../control/space_catalog.js';
import { control_db } from '../../control/control_db.js';
import { mcp_runtime } from '../runtime.js';
import { register_ingest_tool } from './ingest.js';
import { register_remember_decision_tool } from './remember_decision.js';
import { register_update_task_state_tool } from './update_task_state.js';
import { register_manage_skill_tool } from './manage_skill.js';

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
    const directory = mkdtempSync(join(tmpdir(), 'longmemory-write-tools-'));
    const db = new control_db(join(directory, 'control.db'));
    db.create_user({ id: 'alice', display_name: 'Alice' });
    db.create_team({ id: 'core', name: 'Core' });
    db.create_team({ id: 'readers', name: 'Readers' });
    db.add_member('core', 'alice', 'admin');
    db.add_member('readers', 'alice', 'viewer');
    const alice_token = db.create_token({ user_id: 'alice', label: 'alice-write' }).token;
    const catalog = create_space_catalog({ db_path: join(directory, 'memory.db'), tenant_id: 'default', control: db, memory: {} });
    const auth = catalog.authenticate_token(alice_token);
    if (!auth.ok) throw new Error(`authentication failed: ${auth.code}`);
    const identity: catalog_identity = auth.identity;
    const runtime = (space_id?: string) => new mcp_runtime({
        catalog, identity, tenant_id: 'default',
        ...(space_id ? { space_id } : {}),
    });
    return {
        catalog, identity, runtime,
        close: async () => {
            await catalog.close();
            db.close();
            rmSync(directory, { recursive: true, force: true });
        },
    };
};

const parse = (result: { content: Array<{ text: string }> }): any => JSON.parse(result.content[0].text);

test('a viewer cannot write to a read-only space and no rows are written', async () => {
    const f = fixture();
    const runtime = f.runtime();
    const { server, tools } = capture_server();
    register_ingest_tool(server, runtime);
    register_remember_decision_tool(server, runtime);
    register_update_task_state_tool(server, runtime);
    register_manage_skill_tool(server, runtime);

    const ingest = tools.find((tool) => tool.name === 'longmemory_ingest')!.handler;
    await assert.rejects(
        ingest({ text: 'note', source: 'test', space: 'team:readers' }),
        /not writable|read-only|space_forbidden/i,
    );
    const project_context = tools.find((tool) => tool.name === 'longmemory_remember_decision')!.handler;
    await assert.rejects(
        project_context({ project_id: 'release', decision: 'ship', reason: 'because', space: 'team:readers' }),
        /not writable|read-only|space_forbidden/i,
    );
    assert.equal((await runtime.memory.listWorlds()).filter((world) => world.metadata.hierarchy === 'project').length, 0);
    await f.close();
});

test('a member writes to team core and readers do not see it from personal', async () => {
    const f = fixture();
    const runtime = f.runtime();
    const { server, tools } = capture_server();
    register_ingest_tool(server, runtime);

    const ingest = tools.find((tool) => tool.name === 'longmemory_ingest')!.handler;
    const result = parse(await ingest({ text: 'team deploy runbook', source: 'test', space: 'team:core' }));
    assert.equal(result.space, 'team:core');
    assert.equal(result.space_label, 'Core');
    assert.ok(result.memory_id);

    const core = runtime.for_space('team:core');
    const personal = runtime.for_space('personal');
    const core_hits = await core.memory.recall({ text: 'deploy', mode: 'strict', token_budget: 256, permission_context: { user_id: 'alice', project_ids: [], allow_private: true } }) as { items?: unknown[] };
    const personal_hits = await personal.memory.recall({ text: 'deploy', mode: 'strict', token_budget: 256, permission_context: { user_id: 'alice', project_ids: [], allow_private: true } }) as { items?: unknown[] };
    assert.ok((core_hits.items ?? []).length > 0);
    assert.equal((personal_hits.items ?? []).length, 0);
    await f.close();
});

test('space all is rejected by every write tool', async () => {
    const f = fixture();
    const runtime = f.runtime();
    const { server, tools } = capture_server();
    register_ingest_tool(server, runtime);
    register_remember_decision_tool(server, runtime);
    register_update_task_state_tool(server, runtime);
    register_manage_skill_tool(server, runtime);

    const ingest = tools.find((tool) => tool.name === 'longmemory_ingest')!.handler;
    await assert.rejects(ingest({ text: 'note', source: 'test', space: 'all' }), /space all is not writable/);
    const decision = tools.find((tool) => tool.name === 'longmemory_remember_decision')!.handler;
    await assert.rejects(decision({ project_id: 'release', decision: 'ship', reason: 'because', space: 'all' }), /space all is not writable/);
    const task = tools.find((tool) => tool.name === 'longmemory_update_task_state')!.handler;
    await assert.rejects(task({ project_id: 'release', task: 'ship', status: 'open', space: 'all' }), /space all is not writable/);
    const skill = tools.find((tool) => tool.name === 'longmemory_manage_skill')!.handler;
    await assert.rejects(skill({ action: 'archive', project_id: 'release', skill_id: 's1', space: 'all' }), /space all is not writable/);
    await f.close();
});

test('a mismatched user_id fails with identity_mismatch', async () => {
    const f = fixture();
    const runtime = f.runtime();
    const { server, tools } = capture_server();
    register_ingest_tool(server, runtime);

    const ingest = tools.find((tool) => tool.name === 'longmemory_ingest')!.handler;
    await assert.rejects(
        ingest({ text: 'note', source: 'test', user_id: 'bob', space: 'personal' }),
        (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.equal((error as any).code, 'identity_mismatch');
            return true;
        },
    );
    await f.close();
});

test('the first write creates the project hierarchy that a read did not', async () => {
    const f = fixture();
    const runtime = f.runtime();
    const { server, tools } = capture_server();
    register_ingest_tool(server, runtime);

    assert.equal(await runtime.find_project('release'), null);
    assert.equal((await runtime.memory.listWorlds()).filter((world) => world.metadata.hierarchy === 'project').length, 0);

    const ingest = tools.find((tool) => tool.name === 'longmemory_ingest')!.handler;
    const result = parse(await ingest({ text: 'decision: release on friday', source: 'test', project_id: 'release', space: 'personal' }));
    assert.equal(result.project_id, 'release');

    const worlds = await runtime.memory.listWorlds();
    assert.ok(worlds.some((world) => world.metadata.project_id === 'release' && world.metadata.hierarchy === 'project'));
    const project = await runtime.find_project('release');
    assert.equal(project?.getProject('release').project_id, 'release');
    await f.close();
});