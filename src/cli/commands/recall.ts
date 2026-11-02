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
 *  file  : src/cli/commands/recall.ts
 *  usage : implements the LongMemory recall component
 */


import type { cli_command } from '../context/cli_context.js';
import { command_flags, flag, has, mode_flag, number_flag, positional, require_value, time_flag, with_read_memory } from '../context/cli_context.js';
import { badge } from '../theme/badges.js';
import { emit, section } from '../output/pretty.js';
import { panel } from '../output/panel.js';
import { table } from '../output/table.js';
import { resolve_project_scope } from '../context/project_scope.js';
import { compact_recall, recall_hits, strip_vectors_replacer } from '../../core/recall/response.js';
import { cli_error, exit_codes } from '../output/errors.js';

export const recall_command: cli_command = async (context) => {
    command_flags(context, ['query', 'mode', 'valid-time', 'recorded-time', 'at', 'k', 'world', 'brief', 'full', 'include-vectors']);
    const query = require_value(positional(context) ?? flag(context, 'query'), 'recall query');
    const mode = mode_flag(context);
    const brief = has(context, 'brief');
    if (brief && (has(context, 'full') || has(context, 'include-vectors'))) {
        throw new cli_error('validation_error', '--brief cannot be combined with --full or --include-vectors', exit_codes.validation);
    }
    const k = number_flag(context, 'k', brief ? 8 : undefined);
    if (k !== undefined && (!Number.isInteger(k) || k < 1 || k > 1000)) {
        throw new cli_error('validation_error', '--k must be an integer between 1 and 1000', exit_codes.validation);
    }
    const raw = await with_read_memory(context, async (memory) => {
        const scope = await resolve_project_scope(memory, context.project_id);
        return memory.recall({
            text: query, mode, token_budget: context.token_budget, k, world_id: flag(context, 'world') ?? scope.root?.id,
            valid_time: time_flag(context, 'valid-time'), recorded_time: time_flag(context, 'recorded-time'), at: time_flag(context, 'at'),
            permission_context: { user_id: context.user_id, project_ids: [context.project_id] }
        });
    });
    const source = raw as Record<string, any>;
    const hits = recall_hits(raw, brief ? k : undefined);
    const result = { ok: true, mode, query, context_packet: source.context ?? source.timeline ?? null, hits, citations: hits.flatMap((hit) => hit.citation ? [{ memory_id: hit.id, source: hit.citation }] : []), debug_trace: source.trace ?? {}, ...(source.items ? { items: source.items } : {}), ...(source.timeline ? { timeline: source.timeline } : {}) };
    let output: unknown = result;
    if (brief) output = { ok: true, mode, query, ...compact_recall(raw, k, context.token_budget) };
    else if (!has(context, 'include-vectors')) output = JSON.parse(JSON.stringify(result, strip_vectors_replacer));
    emit(context, output, () => [
        panel(query, context.colors, { title: 'Recall', kind: 'info', width: context.terminal_width, rows: [['Mode', badge(mode === 'world_grounded' ? 'WORLD' : mode.toUpperCase() as any, true, context.colors)], ['Hits', hits.length], ['Budget', context.token_budget]] }), '',
        hits.length ? section(context, 'Memory hits', table(hits.map((hit) => ({ status: badge(hit.status === 'active' ? 'ACTIVE' : hit.status === 'superseded' ? 'SUPERSEDED' : 'STALE', true, context.colors), score: Number(hit.score).toFixed(3), memory: hit.text, source: hit.citation ?? '—' })), [
            { key: 'status', label: 'STATUS', width: 13 }, { key: 'score', label: 'SCORE', width: 7 }, { key: 'memory', label: 'MEMORY', min: 15 }, { key: 'source', label: 'SOURCE', min: 8 },
        ], context.colors, context.terminal_width)) : context.colors.muted('No memories passed the selected recall gates.'),
        context.debug ? `\n${section(context, 'Debug trace', JSON.stringify(result.debug_trace, null, 2))}` : '',
    ].filter(Boolean).join('\n'));
};
