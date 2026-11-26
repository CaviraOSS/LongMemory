import assert from 'node:assert/strict';
import test from 'node:test';
import { ensure_longmemory_mcp, longmemory_mcp_server } from '../src/config.js';

test('adds the local MCP server when the map is absent', () => {
    const config: Record<string, unknown> = {};
    assert.equal(ensure_longmemory_mcp(config), true);
    assert.deepEqual(config.mcp, {
        longmemory: { type: 'local', command: ['longmemory', 'mcp', '--project', 'current'], enabled: true },
    });
    assert.deepEqual(longmemory_mcp_server(), config.mcp && (config.mcp as Record<string, unknown>).longmemory);
});

test('never overwrites an existing entry, including a disabled or remote one', () => {
    for (const existing of [
        { type: 'local', command: ['custom'], enabled: true },
        { type: 'local', command: ['longmemory', 'mcp'], enabled: false },
        { type: 'remote', url: 'https://memory.test/mcp' },
    ]) {
        const config = { mcp: { longmemory: existing } };
        assert.equal(ensure_longmemory_mcp(config), false);
        assert.deepEqual(config.mcp.longmemory, existing);
    }
});

test('leaves mcp.servers and unrelated keys untouched', () => {
    const servers = { other: { type: 'local', command: ['x'] } };
    const config = { mcp: { servers }, plugin: ['x'] };
    assert.equal(ensure_longmemory_mcp(config), true);
    assert.deepEqual(config.mcp.servers, servers);
    assert.deepEqual(config.plugin, ['x']);
});

test('fails open on an unusable config shape', () => {
    assert.equal(ensure_longmemory_mcp(null), false);
    assert.equal(ensure_longmemory_mcp('nope'), false);
    assert.equal(ensure_longmemory_mcp([]), false);
    const array_mcp = { mcp: [] };
    assert.equal(ensure_longmemory_mcp(array_mcp), false);
    assert.deepEqual(array_mcp.mcp, []);
});

test('returns a fresh server object each call', () => {
    const first = longmemory_mcp_server();
    const second = longmemory_mcp_server();
    assert.notEqual(first, second);
    assert.notEqual(first.command, second.command);
});
