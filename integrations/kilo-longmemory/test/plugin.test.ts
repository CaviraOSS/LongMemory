import assert from 'node:assert/strict';
import test from 'node:test';
import type { Plugin } from '@kilocode/plugin';
import module from '../src/index.js';
import { create_server, message_text } from '../src/index.js';
import { memory_policy } from '../src/policy.js';

type plugin_input = Parameters<Plugin>[0];

const input = { directory: '/work/project' } as unknown as plugin_input;

test('the default export is a Kilo module descriptor', () => {
    assert.equal(module.id, 'longmemory');
    assert.equal(typeof module.server, 'function');
});

test('the config hook adds the local server only when absent', async () => {
    const hooks = await create_server()(input);
    const config: Record<string, unknown> = {};
    await hooks.config?.(config as never);
    assert.deepEqual((config.mcp as Record<string, unknown>).longmemory, {
        type: 'local',
        command: ['longmemory', 'mcp', '--project', 'current'],
        enabled: true,
    });
    const existing = { mcp: { longmemory: { type: 'local', command: ['keep'], enabled: false } } };
    await hooks.config?.(existing as never);
    assert.deepEqual(existing.mcp.longmemory, { type: 'local', command: ['keep'], enabled: false });
});

test('message_text keeps user text and ignores non-text parts', () => {
    assert.equal(message_text([
        { type: 'text', text: 'first' },
        { type: 'tool', text: 'ignored' },
        { type: 'text', text: 'second' },
        { type: 'text', text: 'synthetic', synthetic: true },
        null,
        'nope',
    ]), 'first\nsecond');
    assert.equal(message_text([]), '');
});

test('the system transform always adds the policy and one cached packet per task', async () => {
    const tasks: string[] = [];
    const hooks = await create_server({
        resolve: async (options) => { tasks.push(options.task); return `<evidence>${options.task}</evidence>`; },
    })(input);

    await hooks['chat.message']?.({ sessionID: 's1' } as never, { parts: [{ type: 'text', text: 'ship the release' }] } as never);

    const first: string[] = [];
    await hooks['experimental.chat.system.transform']?.({ sessionID: 's1', model: {} } as never, { system: first } as never);
    assert.deepEqual(first, [memory_policy, '<evidence>ship the release</evidence>']);

    const second: string[] = [];
    await hooks['experimental.chat.system.transform']?.({ sessionID: 's1', model: {} } as never, { system: second } as never);
    assert.deepEqual(second, [memory_policy, '<evidence>ship the release</evidence>']);
    assert.deepEqual(tasks, ['ship the release']);

    await hooks['chat.message']?.({ sessionID: 's1' } as never, { parts: [{ type: 'text', text: 'different task' }] } as never);
    const third: string[] = [];
    await hooks['experimental.chat.system.transform']?.({ sessionID: 's1', model: {} } as never, { system: third } as never);
    assert.deepEqual(third, [memory_policy, '<evidence>different task</evidence>']);
    assert.deepEqual(tasks, ['ship the release', 'different task']);
});

test('the system transform adds only the policy when no context resolves', async () => {
    const hooks = await create_server({ resolve: async () => null })(input);
    await hooks['chat.message']?.({ sessionID: 's2' } as never, { parts: [{ type: 'text', text: 'task' }] } as never);
    const system: string[] = [];
    await hooks['experimental.chat.system.transform']?.({ sessionID: 's2', model: {} } as never, { system } as never);
    assert.deepEqual(system, [memory_policy]);
});

test('the system transform adds only the policy without a known session or task', async () => {
    const hooks = await create_server({ resolve: async () => { throw new Error('must not run'); } })(input);
    const system: string[] = [];
    await hooks['experimental.chat.system.transform']?.({ model: {} } as never, { system } as never);
    assert.deepEqual(system, [memory_policy]);
});
