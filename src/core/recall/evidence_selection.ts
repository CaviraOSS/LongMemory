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
 *  file  : src/core/recall/evidence_selection.ts
 *  usage : implements the LongMemory evidence selection component
 */


export type evidence_selection_options<item> = {
    limit?: number;
    token_budget?: number;
    query_terms: readonly string[];
    exception_query?: boolean;
    terms: (item: item) => ReadonlySet<string>;
    similarity: (left: item, right: item) => number;
    token_cost: (item: item) => number;
    polarity: (item: item) => number;
    relevance: (item: item) => number;
    group?: (item: item) => string | null;
    coverage_weight?: number;
    redundancy_weight?: number;
    polarity_weight?: number;
};

export const default_evidence_selection_depth = 64;

const normalize = (values: readonly number[]): number[] => {
    if (values.length === 0) return [];
    const low = Math.min(...values);
    const high = Math.max(...values);
    if (high - low <= 1e-12) return values.map(() => 0.5);
    return values.map((value) => (value - low) / (high - low));
};

export function select_evidence_set<item>(
    items: readonly item[],
    options: evidence_selection_options<item>,
): item[] {
    const limit = Math.min(items.length, Math.max(0, options.limit ?? items.length));
    if (limit === 0 || items.length === 0) return [];
    const token_budget = options.token_budget ?? Number.POSITIVE_INFINITY;
    const coverage_weight = options.coverage_weight ?? 0.22;
    const redundancy_weight = options.redundancy_weight ?? 0.08;
    const polarity_weight = options.exception_query ? options.polarity_weight ?? 0.9 : 0;
    const aspects = [...new Set(options.query_terms)];
    const item_terms = items.map(options.terms);
    const document_frequency = new Map(aspects.map((aspect) => [aspect, item_terms.reduce((sum, terms) => sum + Number(terms.has(aspect)), 0)]));
    const aspect_weights = new Map(aspects.map((aspect) => [aspect, Math.log(1 + (items.length + 0.5) / ((document_frequency.get(aspect) ?? 0) + 0.5))]));
    const aspect_total = [...aspect_weights.values()].reduce((sum, value) => sum + value, 0) || 1;
    const relevance = normalize(items.map(options.relevance));
    const costs = items.map((item) => Math.max(0, options.token_cost(item)));
    const polarities = items.map(options.polarity);
    const item_groups = items.map((item) => options.group?.(item));
    const similarity_sums = new Array<number>(items.length).fill(0);
    const similarity_counts = new Array<number>(items.length).fill(0);
    const remaining = new Set(items.map((_, index) => index));
    const selected: number[] = [];
    const coverage = new Map<string, number>();
    const groups = new Set<string>();
    let polarity_covered = false;
    let tokens_used = 0;

    while (selected.length < limit && remaining.size > 0) {
        let best = -1;
        let best_gain = Number.NEGATIVE_INFINITY;
        for (const index of remaining) {
            const cost = costs[index];
            if (tokens_used + cost > token_budget) continue;
            let coverage_gain = 0;
            for (const aspect of aspects) {
                if (!item_terms[index].has(aspect)) continue;
                const before = coverage.get(aspect) ?? 0;
                coverage_gain += ((aspect_weights.get(aspect) ?? 0) / aspect_total) * (Math.exp(-before) - Math.exp(-(before + 1)));
            }
            while (similarity_counts[index] < selected.length) {
                const prior = selected[similarity_counts[index]++];
                similarity_sums[index] += Math.max(0, options.similarity(items[index], items[prior]));
            }
            const redundancy = selected.length > 0 ? similarity_sums[index] / selected.length : 0;
            const polarity_gain = polarity_covered ? 0 : Math.max(0, polarities[index]);
            const group = item_groups[index];
            const group_gain = group && !groups.has(group) ? coverage_weight / (groups.size + 1) : 0;
            const gain = relevance[index] + coverage_weight * coverage_gain + group_gain + polarity_weight * polarity_gain - redundancy_weight * redundancy;
            if (gain > best_gain || (gain === best_gain && (best < 0 || index < best))) {
                best = index;
                best_gain = gain;
            }
        }
        if (best < 0) break;
        selected.push(best);
        remaining.delete(best);
        const group = item_groups[best];
        if (group) groups.add(group);
        tokens_used += costs[best];
        for (const aspect of aspects) if (item_terms[best].has(aspect)) coverage.set(aspect, (coverage.get(aspect) ?? 0) + 1);
        if (polarities[best] > 0) polarity_covered = true;
    }

    return selected.map((index) => items[index]);
}
