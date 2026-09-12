/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/ /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/
 *
 *  cavira oss (c) 2026  -  nullure (c) 2026
 *  ----------------------------------------------------------
 *  file  : tools/check-integrations.mjs
 *  usage : validates LongMemory integration release artifacts
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const json = (path) => JSON.parse(read(path));
const required = [
    'integrations/claude-code-longmemory/.claude-plugin/plugin.json',
    'integrations/claude-code-longmemory/.mcp.json',
    'integrations/codex-longmemory/.codex-plugin/plugin.json',
    'integrations/codex-longmemory/.mcp.json',
    'integrations/gemini-cli-longmemory/gemini-extension.json',
    'integrations/longmemory-agent-plugin/plugin.json',
    'integrations/longmemory-agent-plugin/mcp.json',
    'integrations/mcp-configs/cline.json',
    'integrations/mcp-configs/continue.yaml',
    'integrations/mcp-configs/librechat.yaml',
    'integrations/n8n-nodes-longmemory/package.json',
    ...['crewai', 'autogen', 'langgraph', 'openai-agents', 'pydantic-ai'].map(
        (name) => `integrations/frameworks/${name}/main.py`,
    ),
];
const failures = required.filter((path) => !existsSync(resolve(root, path))).map((path) => `${path}: missing`);
for (const path of required.filter((path) => path.endsWith('.json'))) {
    try {
        json(path);
    } catch (error) {
        failures.push(`${path}: invalid JSON (${error.message})`);
    }
}
if (json(required[0]).name !== 'longmemory') failures.push('Claude plugin name must be longmemory');
if (json(required[2]).name !== 'longmemory') failures.push('Codex plugin name must be longmemory');
if (json(required[4]).name !== 'longmemory') failures.push('Gemini extension name must be longmemory');
if (json(required[10]).name !== '@cavira/n8n-nodes-longmemory') failures.push('n8n package name is invalid');
if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log(`validated ${required.length} LongMemory integration artifacts`);
