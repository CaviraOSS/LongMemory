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
*  file  : src/mcp/tools/read_scope.test.ts
*  usage : verifies space-aware read scoping and all-space merge helpers
*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { mcp_runtime } from '../runtime.js';
import { read_scopes, merge_scoped_recall, per_space_budget } from './read_scope.js';
import type { space_descriptor } from '../../control/space_catalog.js';

const make_runtime = (space_id: string, space_label: string): mcp_runtime => {
    const space: space_descriptor = {
        id: space_id, kind: 'team', label: space_label, team_id: space_id, role: 'member',
        partition: space_id, writable: true,
    };
    return {
        space, spaces: [space], space_id, space_explicit: true,
        read_scopes: () => [space],
        write_scope: () => space,
        for_space: (id: string) => { if (id !== space_id) throw new Error(`no access to space: ${id}`); return make_runtime(id, space_label); },
        find_project: async () => null,
    } as unknown as mcp_runtime;
};

test('read_scopes returns the single space when explicit', () => {
    const runtime = make_runtime('team:core', 'Core');
    const scopes = read_scopes(runtime) as space_descriptor[];
    assert.equal(scopes.length, 1);
    assert.equal(scopes[0].id, 'team:core');
});

test('read_scopes forwards a requested space', () => {
    const runtime = make_runtime('team:core', 'Core');
    const scopes = read_scopes(runtime, 'team:core') as space_descriptor[];
    assert.equal(scopes[0].id, 'team:core');
});

test('per_space_budget splits the total and keeps the tool minimum', () => {
    assert.equal(per_space_budget(256, 3), 85);
    assert.equal(per_space_budget(300, 4), 75);
    assert.equal(per_space_budget(100, 3), 64);
    assert.equal(per_space_budget(256, 0), 256);
});

test('merge_scoped_recall labels unlabeled context and preserves per-space errors', () => {
    const base = {
        items: [], timeline: { entries: [], current_truth: [], world_truth_at_time: [], agent_belief_at_time: [] },
        tokens_used: 0, budget: 64, item_count: 0, evidence: 0, bundled_items: 0, within_budget: true,
    };
    const merged = merge_scoped_recall([
        { ...base, space: 'personal', space_label: 'Alice', project_missing: false, error: 'partition unavailable', context: { text: 'hello' } },
        { ...base, space: 'team:core', space_label: 'Core', project_missing: false, context: { text: '' } },
    ], 256);

    assert.equal(merged.context.text, '## Alice\nhello');
    assert.deepEqual(merged.spaces[0], {
        space: 'personal', space_label: 'Alice', project_missing: false, error: 'partition unavailable',
    });
    assert.deepEqual(merged.spaces[1], { space: 'team:core', space_label: 'Core', project_missing: false });
});

test('merge_scoped_recall merges two spaces under budget and tags each entry', () => {
    const results = [
        {
            space: 'personal', space_label: 'Alice', project_missing: false,
            items: [{ node: { id: 'n1' }, score: 0.9 }, { node: { id: 'n2' }, score: 0.5 }],
            timeline: { entries: [{ id: 't1', recorded_at: 100 }, { id: 't2', recorded_at: 50 }], current_truth: [], world_truth_at_time: [], agent_belief_at_time: [] },
            context: { text: '## Alice\nhello' }, tokens_used: 10, budget: 128, item_count: 2, evidence: 1, bundled_items: 0, within_budget: true,
        },
        {
            space: 'team:core', space_label: 'Core', project_missing: false,
            items: [{ node: { id: 'n2' }, score: 0.8 }, { node: { id: 'n3' }, score: 0.7 }],
            timeline: { entries: [{ id: 't2', recorded_at: 50 }, { id: 't3', recorded_at: 200 }], current_truth: [], world_truth_at_time: [], agent_belief_at_time: [] },
            context: { text: '## Core\nworld' }, tokens_used: 20, budget: 128, item_count: 2, evidence: 1, bundled_items: 0, within_budget: true,
        },
    ];
    const merged = merge_scoped_recall(results, 256);
    assert.equal(merged.space, 'all');
    assert.deepEqual(merged.spaces.map((entry: any) => entry.space), ['personal', 'team:core']);
    assert.equal(merged.items.length, 3);
    assert.deepEqual(merged.items.map((item: any) => item.node.id), ['n1', 'n2', 'n3']);
    assert.equal(merged.timeline.entries.length, 3);
    assert.deepEqual(merged.timeline.entries.map((entry: any) => entry.id), ['t3', 't1', 't2']);
    assert.equal(merged.context.text, '## Alice\nhello\n## Core\nworld');
    assert.equal(merged.tokens_used, 30);
    assert.equal(merged.budget, 256);
    assert.equal(merged.item_count, 4);
    assert.equal(merged.evidence, 2);
    assert.equal(merged.bundled_items, 0);
    assert.equal(merged.within_budget, true);
});

test('merge_scoped_recall flags when a single space exceeds its share', () => {
    const results = [{
        space: 'personal', space_label: 'Alice', project_missing: false,
        items: [], timeline: { entries: [], current_truth: [], world_truth_at_time: [], agent_belief_at_time: [] },
        context: { text: '' }, tokens_used: 200, budget: 128, item_count: 0, evidence: 0, bundled_items: 0, within_budget: false,
    }];
    const merged = merge_scoped_recall(results, 256);
    assert.equal(merged.within_budget, false);
    assert.equal(merged.tokens_used, 200);
});