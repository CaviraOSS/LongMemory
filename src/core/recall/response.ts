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
 *  file  : src/core/recall/response.ts
 *  usage : formats recall responses for CLI and MCP clients
 */

import type { long_memory } from '../create_memory.js';
import { build_context_packet } from './context_builder.js';

type recall_result = Awaited<ReturnType<long_memory['recall']>>;

export const strip_vectors_replacer = (key: string, value: unknown) => key === 'vectors' ? undefined : value;

export function recall_hits(result: recall_result, limit?: number) {
    const items = 'items' in result ? result.items : result.timeline.entries;
    return items.slice(0, limit).map((item) => {
        const node = item.node;
        let score: number;
        if ('score' in item) score = item.score;
        else if ('grounding_score' in item) score = item.grounding_score;
        else score = item.is_current ? 1 : 0.5;
        return {
            id: node.id, observed_at: node.temporal.observed_at, score,
            status: node.state.status, text: node.content.summary || node.content.raw,
            grounded: Boolean(node.grounding.worlddb_ref), citation: node.provenance.source_trace[0]?.ref ?? null,
        };
    });
}

export function compact_recall(result: recall_result, limit = 8, token_budget = 2048) {
    const context = 'context' in result
        ? result.context
        : build_context_packet(result.timeline.entries.slice(0, limit), token_budget);
    return {
        context: { text: context.text, tokens_used: context.tokens_used, budget: context.budget },
        hits: recall_hits(result, limit).map(({ id, observed_at, score, status, text }) => ({ id, observed_at, score, status, text })),
    };
}
