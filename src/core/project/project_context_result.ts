/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
*                      /____/                                 /____/
*
*  cavira oss (c) 2026  -  nullure (c) 2026
*  ----------------------------------------------------------
*  file  : src/core/project/project_context_result.ts
*  usage : builds unified project context views for REST routes and MCP tools
*/

import type { project_context_packet } from './project_context.js';

export function project_context_view(
    project_id: string,
    task: string,
    packet: project_context_packet,
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        ok: true,
        schema: 'longmemory.project-context.v1',
        project_id,
        task,
        project_summary: packet.project_summary,
        current_goal: packet.current_goal,
        hard_constraints: packet.hard_constraints,
        relevant_architecture: packet.relevant_architecture,
        relevant_files: packet.relevant_files,
        active_decisions: packet.active_decisions,
        open_tasks: packet.open_tasks,
        known_failures: packet.known_failures,
        matched_skills: packet.matched_skills,
        asset_loadout: packet.asset_loadout,
        conflicts: packet.contradictions,
        suggested_next_steps: packet.suggested_next_steps,
        citations: packet.citations,
        debug_trace: packet.debug_trace,
        ...extra,
    };
}

export function empty_project_context(
    project_id: string,
    task: string,
    token_budget: number,
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        ok: true,
        schema: 'longmemory.project-context.v1',
        project_id,
        task,
        project_summary: project_id,
        current_goal: null,
        hard_constraints: [],
        relevant_architecture: [],
        relevant_files: [],
        active_decisions: [],
        open_tasks: [],
        known_failures: [],
        matched_skills: [],
        asset_loadout: null,
        conflicts: [],
        suggested_next_steps: [],
        citations: [],
        debug_trace: {
            task,
            token_budget,
            tokens_used: 0,
            within_budget: true,
        },
        project_missing: true,
        ...extra,
    };
}
