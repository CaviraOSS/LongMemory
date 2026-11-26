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
*  file  : tools/skill-paths.mjs
*  usage : names the canonical LongMemory skill and its host copies
*/

// A target lives at integrations/<package>/skills/longmemory/SKILL.md. Keeping
// the paths in a leaf module lets both the sync and the check import them
// without forming a module cycle.
export const shared_skill = 'integrations/_shared/longmemory/SKILL.md';

export const skill_targets = [
    'integrations/claude-code-longmemory/skills/longmemory/SKILL.md',
    'integrations/codex-longmemory/skills/longmemory/SKILL.md',
    'integrations/longmemory-agent-plugin/skills/longmemory/SKILL.md',
    'integrations/antigravity-longmemory/skills/longmemory/SKILL.md',
    'integrations/kilo-longmemory/skills/longmemory/SKILL.md',
];
