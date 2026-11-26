/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ `/ __ `/ __ `/ /|_/ / _ / __ `__ / __ / ___/ / / /
*   / /___/ /_/ / / / / /_/ / / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/ /____/_/   \__, /
*                      /____/                                 /____/
*
*  cavira oss (c) 2022  -  nullure (c) 2026
*  ----------------------------------------------------------
*  file  : src/mcp/resources/resources.test.ts
*  usage : verifies resources never create projects and stay in the write-default space
*/

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { create_space_catalog, type catalog_identity } from '../../control/space_catalog.js';
import { control_db } from '../../control/control_db.js';
import { mcp_runtime } from '../runtime.js';
import { register_project_context_resource } from './project_context.js';
import { register_decisions_resource } from './decisions.js';
import { register_tasks_resource } from './tasks.js';
import { register_skills_resource } from './skills.js';
import { register_assets_resources } from './assets.js';
import { register_conflicts_resource } from './conflicts.js';
import { register_project_summary_resource } from './project_summary.js';
import { register_agent_manifest_resource } from './agent_manifest.js';

type captured = { name: string; handler: (uri: URL, values: Record<string, string | string[]>) => Promise<{ contents: Array<{ text: string }> }> };

const capture_server = () => {
    const resources: captured[] = [];
    const server = {
        registerResource(name: string, _template: unknown, _config: unknown, handler: captured['handler']) {
            resources.push({ name, handler });
        },
    };
    return { server: server as any, resources };
};

const fixture = () => {
    const directory = mkdtempSync(join(tmpdir(), 'longmemory-resources-'));
    const db = new control_db(join(directory, 'control.db'));
    db.create_user({ id: 'alice', display_name: 'Alice' });
    db.create_team({ id: 'core', name: 'Core' });
    db.add_member('core', 'alice', 'admin');
    const alice_token = db.create_token({ user_id: 'alice', label: 'alice-resources' }).token;
    const catalog = create_space_catalog({ db_path: join(directory, 'memory.db'), tenant_id: 'default', control: db, memory: {} });
    const auth = catalog.authenticate_token(alice_token);
    if (!auth.ok) throw new Error(`authentication failed: ${auth.code}`);
    const identity: catalog_identity = auth.identity;
    return {
        catalog, identity,
        runtime: new mcp_runtime({ catalog, identity, tenant_id: 'default', space_explicit: false }),
        close: async () => {
            await catalog.close();
            db.close();
            rmSync(directory, { recursive: true, force: true });
        },
    };
};

const parse = (result: { contents: Array<{ text: string }> }): any => JSON.parse(result.contents[0].text);

test('every project resource reports project_missing without creating worlds', async () => {
    const f = fixture();
    const { server, resources } = capture_server();
    register_project_context_resource(server, f.runtime);
    register_decisions_resource(server, f.runtime);
    register_tasks_resource(server, f.runtime);
    register_skills_resource(server, f.runtime);
    register_assets_resources(server, f.runtime);
    register_conflicts_resource(server, f.runtime);
    register_project_summary_resource(server, f.runtime);
    register_agent_manifest_resource(server, f.runtime);

    const call = async (name: string, values: Record<string, string | string[]>) => {
        const resource = resources.find((item) => item.name === name)!;
        return parse(await resource.handler(new URL(`longmemory://project/release/${name}`), values));
    };

    const context = await call('longmemory-project-current-context', { project_id: 'release' });
    assert.equal(context.project_id, 'release');
    assert.equal(context.project_missing, true);
    assert.deepEqual(context.open_tasks, []);

    const decisions = await call('longmemory-project-decisions', { project_id: 'release' });
    assert.equal(decisions.project_missing, true);
    assert.deepEqual(decisions.decisions, []);

    const tasks = await call('longmemory-project-tasks', { project_id: 'release' });
    assert.equal(tasks.project_missing, true);
    assert.deepEqual(tasks.tasks, []);

    const skills = await call('longmemory-project-skills', { project_id: 'release' });
    assert.equal(skills.project_missing, true);
    assert.deepEqual(skills.skills, []);

    const assets = await call('longmemory-project-assets', { project_id: 'release' });
    assert.equal(assets.project_missing, true);
    assert.deepEqual(assets.assets, []);

    const conflicts = await call('longmemory-project-conflicts', { project_id: 'release' });
    assert.equal(conflicts.project_missing, true);
    assert.deepEqual(conflicts.conflicts, []);

    const summary = await call('longmemory-project-summary', { project_id: 'release' });
    assert.equal(summary.project_missing, true);

    const manifest = await call('longmemory-agent-memory-manifest', { project_id: 'release', agent_id: 'agent-1' });
    assert.equal(manifest.project_missing, true);

    const worlds = await f.runtime.memory.listWorlds();
    assert.equal(worlds.filter((world) => world.metadata.hierarchy === 'project').length, 0);
    await f.close();
});

test('resources use the write-default space, not all', async () => {
    const f = fixture();
    assert.equal(f.runtime.space_explicit, false);
    assert.equal(f.runtime.space.id, 'personal');
    const { server, resources } = capture_server();
    register_project_context_resource(server, f.runtime);
    const resource = resources.find((item) => item.name === 'longmemory-project-current-context')!;
    const result = parse(await resource.handler(new URL('longmemory://project/release/current-context'), { project_id: 'release' }));
    assert.equal(result.project_missing, true);
    assert.notEqual(result.space, 'all');
    await f.close();
});

test('an existing project resource still returns its data', async () => {
    const f = fixture();
    const manager = await f.runtime.project('release');
    const context = await manager.getProjectContext('release', 'current project work', 2048);

    const { server, resources } = capture_server();
    register_project_summary_resource(server, f.runtime);
    register_project_context_resource(server, f.runtime);

    const summary = parse(await resources.find((item) => item.name === 'longmemory-project-summary')!.handler(new URL('longmemory://project/release/summary'), { project_id: 'release' }));
    assert.equal(summary.project_missing, undefined);
    assert.equal(summary.project_id, 'release');
    assert.equal(summary.name, 'release');

    const current = parse(await resources.find((item) => item.name === 'longmemory-project-current-context')!.handler(new URL('longmemory://project/release/current-context'), { project_id: 'release' }));
    assert.equal(current.project_id, 'release');
    assert.equal(current.project_summary, context.project_summary);
    await f.close();
});