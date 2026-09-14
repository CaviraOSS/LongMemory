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
 *  file  : src/core/recall/context_builder.ts
 *  usage : implements the LongMemory context builder component
 */


import type { HydroNode } from '../types/hydro_node.js';
import { count_multilingual_tokens } from '../i18n/multilingual_tokenizer.js';
import { memory_evidence_of, type memory_evidence } from './evidence.js';

function code_point_length(text: string): number {
    let count = 0;
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
            const next = text.charCodeAt(index + 1);
            if (next >= 0xdc00 && next <= 0xdfff) index++;
        }
        count++;
    }
    return count;
}

export function count_tokens(text: string): number {
    const t = (text || '').trim();
    if (!t) return 0;
    return Math.max(1, count_multilingual_tokens(t), Math.ceil(code_point_length(t) / 4));
}

export type ContextPacket = {
    text: string;
    tokens_used: number;
    budget: number;
    items: HydroNode[];
    evidence: memory_evidence[];
    within_budget: boolean;
    bundled_items: number;
};

export type context_packet_options = {
    query_terms?: readonly string[];
    bundles?: ReadonlyMap<string, readonly HydroNode[]>;
};


export function build_context_packet(
    scored: readonly { node: HydroNode }[],
    budget: number,
    options: context_packet_options = {},
): ContextPacket {
    const items: HydroNode[] = [];
    const evidence: memory_evidence[] = [];
    const lines: string[] = [];
    const claim_cache = new Map<HydroNode, memory_evidence>();
    const raw_cache = new Map<HydroNode, memory_evidence>();
    const render = (node: HydroNode, prefer_raw: boolean): memory_evidence => {
        const cache = prefer_raw ? raw_cache : claim_cache;
        const cached = cache.get(node);
        if (cached) return cached;
        const value = memory_evidence_of(node, { query_terms: options.query_terms, prefer_raw });
        cache.set(node, value);
        return value;
    };
    let tokens_used = 0;
    let bundled_items = 0;

    for (const candidate of scored) {
        let bundle = [...new Map((options.bundles?.get(candidate.node.id) ?? [])
            .filter((node) => node.id !== candidate.node.id && node.world.world_id === candidate.node.world.world_id
                && (node.metadata.user_id ?? node.provenance.created_by) === (candidate.node.metadata.user_id ?? candidate.node.provenance.created_by)
                && node.metadata.conversation_id === candidate.node.metadata.conversation_id
                && node.temporal.observed_at <= candidate.node.temporal.observed_at)
            .map((node) => [node.id, node])).values()];
        let item_evidence = render(candidate.node, bundle.length > 0);
        let evidence_items = [...bundle.map((node) => render(node, true)), item_evidence];
        let evidence_text = bundle.length
            ? [...evidence_items]
                .sort((left, right) => left.observed_at - right.observed_at)
                .map((item) => item.text)
                .join(' | ')
            : item_evidence.text;
        let rendered = `- ${evidence_text}`;
        let cost = count_tokens(rendered) + Number(lines.length > 0);
        if (tokens_used + cost > budget && bundle.length) {
            bundle = [];
            item_evidence = render(candidate.node, false);
            evidence_items = [item_evidence];
            evidence_text = item_evidence.text;
            rendered = `- ${evidence_text}`;
            cost = count_tokens(rendered) + Number(lines.length > 0);
        }
        if (tokens_used + cost > budget) continue;
        items.push(candidate.node);
        evidence.push({ ...item_evidence, text: evidence_text, sources: evidence_items.flatMap((item) => item.sources ?? []) });
        lines.push(rendered);
        tokens_used += cost;
        bundled_items += bundle.length;
    }

    return {
        text: lines.join('\n'),
        tokens_used: tokens_used,
        budget,
        items,
        evidence,
        within_budget: tokens_used <= budget,
        bundled_items,
    };
}
