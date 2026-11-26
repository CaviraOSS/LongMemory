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
*  file  : src/mcp/tools/read_scope.ts
*  usage : space-aware read scoping and all-space merge helpers
*/

import type { mcp_runtime } from '../runtime.js';
import type { project_memory } from '../../core/project/project_memory.js';
import type { space_descriptor } from '../../control/space_catalog.js';

export function read_scopes(runtime: mcp_runtime, requested?: string): space_descriptor[] | 'all' {
    return runtime.read_scopes(requested);
}

export function scoped_space_runtime(runtime: mcp_runtime, space: space_descriptor): mcp_runtime {
    return runtime.for_space(space.id);
}

export function scoped_project(runtime: mcp_runtime, project_id: string): Promise<project_memory | null> {
    return runtime.find_project(project_id);
}

// Every all-space read retrieves independently, so each space gets an equal share of the
// caller's budget instead of each spending the whole budget and overrunning the total.
export function per_space_budget(budget: number, space_count: number): number {
    return space_count > 0 ? Math.max(64, Math.floor(budget / space_count)) : budget;
}

type scoped_recall_entry = {
    space: string;
    space_label: string;
    project_missing: boolean;
    error?: string;
    items?: Array<{ node: { id: string }; score?: number }>;
    timeline?: {
        entries?: Array<{ id: string; recorded_at: number }>;
        current_truth?: unknown[];
        world_truth_at_time?: unknown[];
        agent_belief_at_time?: unknown[];
    };
    context?: { text: string };
    tokens_used?: number;
    budget?: number;
    item_count?: number;
    evidence?: number;
    bundled_items?: number;
    within_budget?: boolean;
};

type merged_recall = {
    space: 'all';
    spaces: Array<{ space: string; space_label: string; project_missing: boolean; error?: string }>;
    items: Array<{ node: { id: string }; score?: number }>;
    timeline: {
        entries: Array<{ id: string; recorded_at: number }>;
        current_truth: unknown[];
        world_truth_at_time: unknown[];
        agent_belief_at_time: unknown[];
    };
    context: { text: string };
    tokens_used: number;
    budget: number;
    item_count: number;
    evidence: number;
    bundled_items: number;
    within_budget: boolean;
};

export function merge_scoped_recall(results: scoped_recall_entry[], budget: number): merged_recall {
    if (results.length === 0) {
        return {
            space: 'all',
            spaces: [],
            items: [],
            timeline: { entries: [], current_truth: [], world_truth_at_time: [], agent_belief_at_time: [] },
            context: { text: '' },
            tokens_used: 0,
            budget,
            item_count: 0,
            evidence: 0,
            bundled_items: 0,
            within_budget: true,
        };
    }

    const items_map = new Map<string, { node: { id: string }; score?: number }>();
    const timeline_entries_map = new Map<string, { id: string; recorded_at: number }>();

    let total_tokens_used = 0;
    let total_item_count = 0;
    let total_evidence = 0;
    let total_bundled_items = 0;
    let total_within_budget = true;

    for (const entry of results) {
        total_tokens_used += entry.tokens_used ?? 0;
        total_item_count += entry.item_count ?? entry.items?.length ?? 0;
        total_evidence += entry.evidence ?? 0;
        total_bundled_items += entry.bundled_items ?? 0;
        total_within_budget = total_within_budget && (entry.within_budget ?? true);

        for (const item of entry.items ?? []) {
            items_map.set(item.node.id, item);
        }

        for (const timeline_entry of entry.timeline?.entries ?? []) {
            timeline_entries_map.set(timeline_entry.id, timeline_entry);
        }
    }

    const items = Array.from(items_map.values()).sort((a, b) => {
        if (a.score !== undefined && b.score !== undefined) return b.score - a.score;
        return 0;
    });

    const timeline_entries = Array.from(timeline_entries_map.values()).sort((a, b) => {
        if (b.recorded_at !== a.recorded_at) return b.recorded_at - a.recorded_at;
        return a.id.localeCompare(b.id);
    });

    const merged_context = results
        .map((r) => {
            const text = r.context?.text ?? '';
            if (!text) return '';
            return text.startsWith('## ') ? text : `## ${r.space_label}\n${text}`;
        })
        .filter(Boolean)
        .join('\n');

    return {
        space: 'all',
        spaces: results.map((r) => ({
            space: r.space, space_label: r.space_label, project_missing: r.project_missing,
            ...(r.error ? { error: r.error } : {}),
        })),
        items,
        timeline: {
            entries: timeline_entries,
            current_truth: results.flatMap((r) => r.timeline?.current_truth ?? []),
            world_truth_at_time: results.flatMap((r) => r.timeline?.world_truth_at_time ?? []),
            agent_belief_at_time: results.flatMap((r) => r.timeline?.agent_belief_at_time ?? []),
        },
        context: { text: merged_context },
        tokens_used: total_tokens_used,
        budget,
        item_count: total_item_count,
        evidence: total_evidence,
        bundled_items: total_bundled_items,
        within_budget: total_within_budget,
    };
}