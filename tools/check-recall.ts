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
 *  file  : tools/check-recall.ts
 *  usage : fast end-to-end smoke test of ingest + all four recall modes
 */

import assert from 'node:assert/strict';
import { createMemory } from '../src/index.js';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { create_longmemory_mcp } from '../src/mcp/mcp_server.js';
import { run_cli_app } from '../src/cli/cli_app.js';

async function cli(db_path: string, args: string[], expected_code = 0) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await run_cli_app([...args, '--db', db_path, '--project', 'recall-check', '--json'], {}, {
        stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value), terminal: false,
    });
    assert.equal(code, expected_code, stderr.join('\n'));
    return JSON.parse((code === 0 ? stdout : stderr).join('\n'));
}

async function check_cli_output(db_path: string) {
    const args = ['recall', 'release checklist', '--mode', 'strict', '--k', '2', '--token-budget', '300'];
    const full = await cli(db_path, [...args, '--full']);
    const brief = await cli(db_path, [...args, '--brief']);
    const vectors = await cli(db_path, [...args, '--include-vectors']);
    assert.equal(full.hits.length, 2);
    assert.equal(brief.hits.length, 2);
    assert.equal(brief.context.text, full.context_packet.text);
    assert.equal(brief.context.tokens_used, full.context_packet.tokens_used);
    assert.ok(brief.context.tokens_used <= 300);
    assert.deepEqual(brief.hits.map((hit: any) => hit.id), full.hits.map((hit: any) => hit.id));
    assert.ok(brief.hits.every((hit: any) => Number.isFinite(hit.observed_at) && hit.text));
    assert.ok(!('items' in brief) && !('debug_trace' in brief));
    assert.ok(!JSON.stringify(full).includes('"vectors":'));
    assert.ok(vectors.items[0].node.vectors.semantic.length > 0);
    assert.ok(vectors.context_packet.items[0].vectors.semantic.length > 0);
    assert.ok(JSON.stringify(brief).length < JSON.stringify(full).length / 2);
    assert.equal((await cli(db_path, ['recall', 'release checklist', '--mode', 'strict', '--brief'])).hits.length, 8);
    for (const mode of ['historical', 'associative', 'world_grounded']) {
        const result = await cli(db_path, ['recall', 'release checklist', '--mode', mode, '--brief', '--k', '1', '--token-budget', '64']);
        assert.ok(result.hits.length <= 1);
        assert.ok(result.context.tokens_used <= 64);
    }
    for (const invalid of [['--brief', '--full'], ['--brief', '--include-vectors'], ['--k', '0'], ['--k', '1.5']]) {
        await cli(db_path, [...args, ...invalid], 2);
    }
}

async function check_mcp_output(db_path: string) {
    const { server, runtime } = create_longmemory_mcp({ db_path, project_id: 'recall-check', read_only: true, audit_path: null, env: {} });
    const client = new Client({ name: 'recall-check', version: '1' });
    const [client_transport, server_transport] = InMemoryTransport.createLinkedPair();
    await server.connect(server_transport);
    await client.connect(client_transport);
    const call = async (extra: Record<string, unknown> = {}) => {
        const result = await client.callTool({ name: 'longmemory_recall', arguments: { query: 'release checklist', mode: 'strict', token_budget: 300, ...extra } });
        assert.ok(!result.isError, JSON.stringify(result));
        const content = (result.content as Array<{ type: string; text: string }>).find((item) => item.type === 'text');
        assert.ok(content);
        return JSON.parse(content.text);
    };
    try {
        assert.equal((await call()).hits.length, 8);
        const compact = await call({ k: 2 });
        const verbose = await call({ k: 2, verbose: true });
        assert.equal(compact.hits.length, 2);
        assert.equal(verbose.items.length, 2);
        assert.equal(compact.context.text, verbose.context.text);
        assert.deepEqual(compact.hits.map((hit: any) => hit.id), verbose.items.map((item: any) => item.node.id));
        assert.ok(!('items' in compact) && !('trace' in compact));
        assert.ok(!JSON.stringify(verbose).includes('"vectors":'));
        assert.ok((await call({ k: 2, verbose: true, include_vectors: true })).items[0].node.vectors.semantic.length > 0);
        assert.ok((await call({ verbose: true })).items.length > 8);
        for (const mode of ['historical', 'associative', 'world_grounded']) {
            const result = await call({ mode, k: 1, token_budget: 64 });
            assert.ok(result.hits.length <= 1);
            assert.ok(result.context.tokens_used <= 64);
            const full = await call({ mode, verbose: true });
            assert.ok('trace' in full);
            assert.ok(!JSON.stringify(full).includes('"vectors":'));
        }
        const empty = await call({ mode: 'historical', query: 'qzxnonexistent' });
        assert.equal(empty.hits.length, 0);
        assert.equal(empty.context.text, '');
        for (const extra of [{ k: 0 }, { k: 1.5 }, { project_id: 'other-project' }, { user_id: 'other-user' }]) {
            const denied = await client.callTool({ name: 'longmemory_recall', arguments: { query: 'release checklist', mode: 'strict', ...extra } });
            assert.equal(denied.isError, true);
        }
    } finally {
        await client.close();
        await server.close();
        await runtime.close();
    }
}

async function check_recall_transports() {
    const temporary_root = resolve('tmp');
    mkdirSync(temporary_root, { recursive: true });
    const directory = mkdtempSync(join(temporary_root, 'recall-check-'));
    const db_path = join(directory, 'memory.db');
    try {
        await cli(db_path, ['project', 'init']);
        for (const topic of ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet']) {
            await cli(db_path, ['ingest', `The ${topic} release checklist lives in docs/${topic}.md.`, '--external=true']);
        }
        await check_cli_output(db_path);
        await check_mcp_output(db_path);
    } finally { rmSync(directory, { recursive: true, force: true }); }
}

async function main() {
    const memory = createMemory({ store: 'memory', embedding_dimension: 2 });

    const status = memory.status();
    assert.equal(status.ready, true, 'engine should report ready immediately after construction');

    const first = await memory.ingest({ user_id: 'check-recall', text: 'The release checklist lives in tools/.', world: 'release-check', vector: [1, 0] });
    assert.ok(first.node.id, 'ingest should return a node id');

    const strict = await memory.recall({ text: 'Where does the release checklist live?', mode: 'strict', vector: [1, 0], k: 3 });
    assert.ok('items' in strict && strict.items.some((item) => item.node.id === first.node.id), 'strict recall should surface the ingested node');

    const superseding = await memory.ingest({ user_id: 'check-recall', text: 'The release checklist now lives in docs/.', world: 'release-check', vector: [1, 0], at: Date.now() + 1 });
    assert.ok(superseding.node.id !== first.node.id, 'a superseding observation should create a new node, not mutate the old one');

    const historical = await memory.getTimeline({});
    assert.ok(historical.timeline.entries.some((entry) => entry.node.id === first.node.id), 'historical recall should still return the superseded node');

    const associative = await memory.recall({ text: 'release checklist', mode: 'associative', vector: [1, 0], k: 5 });
    assert.ok('items' in associative && associative.items.length > 0, 'associative recall should return at least one candidate');

    const worlds = await memory.listWorlds();
    assert.ok(worlds.some((world) => world.id === 'release-check' || world.name === 'release-check'), 'the ingested world should be listed');

    await memory.close();
    const preferences = createMemory({ store: 'memory', embedding_dimension: 2 });
    try {
        const at = Date.now() - 1000;
        await preferences.ingest({ user_id: 'profile-check', text: 'I lead the payments team. I prefer dark mode for the editor.', world: 'profile-check', vector: [1, 0], at });
        await preferences.ingest({ user_id: 'profile-check', text: 'Actually, switch me to light mode.', world: 'profile-check', vector: [1, 0], at: at + 1 });
        const current = await preferences.recall({ text: 'Which editor mode do I prefer now?', mode: 'associative', vector: [1, 0], k: 5 });
        assert.ok('context' in current && current.context.evidence[0].text.includes('light mode'), 'current mode query should prefer the relevant replacement');
        assert.ok('context' in current && current.context.evidence.some((item) => item.text.includes('superseded')), 'associative recall should retain labeled history');
        const team = await preferences.recall({ text: 'Which team do I lead now?', mode: 'associative', vector: [1, 0], k: 1 });
        assert.ok('context' in team && team.context.evidence[0].text.includes('payments'), 'an unrelated replacement must not hide a still-relevant claim');
        const earlier = await preferences.recall({ text: 'Which mode did I prefer before?', mode: 'associative', vector: [1, 0], k: 5 });
        assert.ok('context' in earlier && earlier.context.evidence.some((item) => item.text.includes('dark mode')), 'historical questions should retain old preferences');
        await preferences.ingest({ user_id: 'profile-check', text: 'I now prefer high contrast mode.', world: 'profile-check', vector: [1, 0], at: at + 2 });
        const latest = await preferences.recall({ text: 'Which mode do I prefer now?', mode: 'associative', vector: [1, 0], k: 1 });
        assert.ok('context' in latest && latest.context.evidence[0].text.includes('high contrast'), 'current questions should follow transitive supersession chains');
    } finally { await preferences.close(); }
    await check_recall_transports();
    console.log('recall:check: core recall, CLI and MCP output, limits, vectors and scope checks passed.');
}

main().catch((error) => {
    console.error('recall:check failed:', error);
    process.exit(1);
});
