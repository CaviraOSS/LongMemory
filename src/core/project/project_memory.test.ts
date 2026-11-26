/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/
 *
 *  cavira oss (c) 2026  -  nullure (c) 2026
 *  ----------------------------------------------------------
 *  file  : src/core/project/project_memory.test.ts
 *  usage : verifies project hierarchies are never created from a read path
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMemory } from '../create_memory.js';
import { project_memory } from './project_memory.js';

// better-sqlite3 refuses `readonly` on a temporary database, so the read-only store has to be a
// file that already exists; the guard is what must stop the write, not the store error.
test('readonly createProject never writes a missing hierarchy', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'longmemory-project-memory-'));
    const db_path = join(directory, 'memory.db');
    await createMemory({ store: 'sqlite', db_path }).close();
    const memory = createMemory({ store: 'sqlite', db_path, readonly: true });
    const manager = new project_memory({ memory, tenant_id: 'default', project_id: 'missing', name: 'Missing', readonly: true });
    const worlds_before = await memory.listWorlds();
    await assert.rejects(
        manager.createProject({ tenant_id: 'default', project_id: 'missing', name: 'Missing' }),
        /read-only|project_not_found/,
    );
    const worlds_after = await memory.listWorlds();
    assert.equal(worlds_after.length, worlds_before.length);
    assert.equal(worlds_after.filter((world) => world.metadata.hierarchy === 'project').length, 0);
    await memory.close();
    rmSync(directory, { recursive: true, force: true });
});

test('openProject hydrates an existing hierarchy without writing', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'longmemory-project-memory-open-'));
    const db_path = join(directory, 'memory.db');
    const writable = createMemory({ store: 'sqlite', db_path });
    const writer = new project_memory({ memory: writable, tenant_id: 'default', project_id: 'release', name: 'Release' });
    await writer.createProject({ tenant_id: 'default', project_id: 'release', name: 'Release' });
    const worlds_before = await writable.listWorlds();
    await writable.close();

    const memory = createMemory({ store: 'sqlite', db_path, readonly: true });
    const reader = new project_memory({ memory, tenant_id: 'default', project_id: 'release', name: 'Release', readonly: true });
    const project = await reader.openProject({ tenant_id: 'default', project_id: 'release', name: 'Release' });

    assert.equal(project.project_id, 'release');
    assert.ok(project.root_world_id.length > 0);
    assert.equal(project.name, 'Release');
    assert.equal(reader.getProject('release').root_world_id, project.root_world_id);
    assert.equal((await memory.listWorlds()).length, worlds_before.length);
    await memory.close();
    rmSync(directory, { recursive: true, force: true });
});

test('openProject refuses a missing hierarchy without creating worlds', async () => {
    const memory = createMemory({ store: 'sqlite', db_path: ':memory:' });
    const manager = new project_memory({ memory, tenant_id: 'default', project_id: 'absent', name: 'Absent' });
    await assert.rejects(
        manager.openProject({ tenant_id: 'default', project_id: 'absent', name: 'Absent' }),
        /does not exist/,
    );
    assert.equal((await memory.listWorlds()).filter((world) => world.metadata.hierarchy === 'project').length, 0);
    await memory.close();
});
