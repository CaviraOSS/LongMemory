/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ `/ __ `/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__,_/_/  /_/\___/_/ /_/ /_/ /_/\____/_/   \__, /
                     /____/
*
*  cavira oss (c) 2026  -  nullure (c) 2026
*  ----------------------------------------------------------
*  file  : src/server/routes/project_context.test.ts
*  usage : verifies shared project context API behavior
*/

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMemory } from '../../core/create_memory.js';
import { project_memory } from '../../core/project/project_memory.js';
import { mcp_runtime } from '../../mcp/runtime.js';
import type { route_context } from '../app.js';
import { api_error } from '../middleware/errors.js';
import { project_context_route } from './project_context.js';

const test_memory = () => {
    const directory = mkdtempSync(join(tmpdir(), 'longmemory-project-context-'));
    const memory = createMemory({ store: 'sqlite', db_path: join(directory, 'memory.db') });
    return { memory, close: async () => { await memory.close(); rmSync(directory, { recursive: true, force: true }); } };
};

const with_context = async (body: unknown, memory: ReturnType<typeof createMemory>) => {
    const runtime = new mcp_runtime({ memory, tenant_id: 'tenant-1', user_id: 'user-1' });
    const context: route_context = {
        body,
        memory,
        runtime,
        identity: runtime.identity,
        header_space: null,
        config: {
            memory: { store: 'sqlite', db_path: ':memory:', tenant_id: 'tenant-1', user_id: 'user-1', max_context_tokens: 2048 },
        } as route_context['config'],
    } as route_context;
    const result = await project_context_route(context);
    await runtime.close();
    return { memory, result };
};

test('returns an existing project context without creating another hierarchy', async () => {
    const store = test_memory();
    const { memory } = store;
    const manager = new project_memory({ memory, tenant_id: 'tenant-1', project_id: 'release', name: 'Release' });
    await manager.createProject({ tenant_id: 'tenant-1', project_id: 'release', name: 'Release' });
    const worlds_before = await memory.listWorlds();

    const { result } = await with_context({ task: 'review release', project_id: 'release', token_budget: 256 }, memory);

    assert.equal((result.data as { ok: boolean }).ok, true);
    assert.equal((result.data as { schema: string }).schema, 'longmemory.project-context.v1');
    assert.equal((result.data as { project_missing?: boolean }).project_missing, undefined);
    assert.equal((await memory.listWorlds()).length, worlds_before.length);
    await manager.close();
    await store.close();
});

test('resolves an omitted project id to the cwd project', async () => {
    const store = test_memory();
    const probe = new mcp_runtime({ memory: store.memory, tenant_id: 'tenant-1', user_id: 'user-1' });
    const project_id = probe.resolve_project_id();
    await probe.close();
    const manager = new project_memory({ memory: store.memory, tenant_id: 'tenant-1', project_id, name: project_id });
    await manager.createProject({ tenant_id: 'tenant-1', project_id, name: project_id });

    const { result } = await with_context({ task: 'review release' }, store.memory);

    assert.equal((result.data as { project_id: string }).project_id, project_id);
    assert.equal((result.data as { project_missing?: boolean }).project_missing, undefined);
    await manager.close();
    await store.close();
});

test('rejects an invalid token budget and reports a missing project without creating worlds', async () => {
    const invalid_store = test_memory();
    await assert.rejects(with_context({ task: 'review release', token_budget: 12 }, invalid_store.memory), api_error);
    await invalid_store.close();
    const store = test_memory();
    const { memory } = store;
    const worlds_before = (await memory.listWorlds()).length;
    const { result } = await with_context({ task: 'review release', project_id: 'missing' }, memory);
    assert.equal((result.data as { project_missing?: boolean }).project_missing, true);
    assert.equal((result.data as { space?: string }).space, 'personal');
    assert.equal((await memory.listWorlds()).length, worlds_before);
    await store.close();
});
