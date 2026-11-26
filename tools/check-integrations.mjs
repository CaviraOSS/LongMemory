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
*  file  : tools/check-integrations.mjs
*  usage : validates integration package/plugin manifests and shared skill copies
*/

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parse_yaml } from 'yaml';
import { is_direct_execution } from './script-entry.mjs';
import { shared_skill, skill_targets } from './skill-paths.mjs';

// n8n is already lint+build checked by `integration:check` before this script runs;
// everything else here only ships a declarative manifest, so parse+required-field
// validation is the meaningful check.
const manifests = [
    'integrations/claude-code-longmemory/.claude-plugin/plugin.json',
    'integrations/codex-longmemory/.codex-plugin/plugin.json',
    'integrations/longmemory-agent-plugin/plugin.json',
    'integrations/gemini-cli-longmemory/gemini-extension.json',
    'integrations/n8n-nodes-longmemory/package.json',
    'integrations/opencode-longmemory/package.json',
];

const mcp_configs = [
    'integrations/claude-code-longmemory/.mcp.json',
    'integrations/codex-longmemory/.mcp.json',
    'integrations/longmemory-agent-plugin/mcp.json',
];

const opencode_files = [
    'integrations/opencode-longmemory/LICENSE',
    'integrations/opencode-longmemory/README.md',
    'integrations/opencode-longmemory/opencode.jsonc',
    'integrations/opencode-longmemory/src/context.ts',
    'integrations/opencode-longmemory/src/index.ts',
    'integrations/opencode-longmemory/tsconfig.json',
];

const agent_plugin_schema = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const agent_mcp_schema = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const agent_plugin_allowed = new Set(['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions']);
const agent_author_allowed = new Set(['name', 'email', 'url']);
const agent_mcp_allowed = new Set(['$schema', 'mcpServers']);
const stdio_allowed = new Set(['type', 'command', 'args', 'env', 'cwd']);
const agent_plugin_name = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const longmemory_token = /\blm_[a-z0-9]{12}_[A-Za-z0-9_-]{16,}\b/i;

const is_record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const find_executable = (command) => {
    const suffixes = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
    for (const directory of (process.env.PATH ?? '').split(delimiter)) {
        if (!directory) continue;
        for (const suffix of suffixes) {
            const candidate = join(directory, `${command}${suffix}`);
            if (existsSync(candidate)) return candidate;
        }
    }
    return null;
};

const run_command = (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60_000 });
    if (result.error) return { status: 1, stdout: '', stderr: result.error.message };
    return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

const antigravity_plugin_dir = 'integrations/antigravity-longmemory';
const kilo_package_dir = 'integrations/kilo-longmemory';
const antigravity_plugin_schema = 'https://antigravity.google/schemas/v1/plugin.json';
const antigravity_plugin_keys = new Set([
    '$schema', 'name', 'displayName', 'description', 'version', 'disabled', 'logo',
    'suggestedPrompts', 'skills', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions',
]);
const antigravity_logo_extensions = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp']);
const antigravity_mcp_keys = new Set(['command', 'args', 'env', 'cwd', 'disabled', 'enabledTools', 'disabledTools', 'tools', 'timeoutSeconds']);
const kebab_name = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const collect_strings = (value) => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(collect_strings);
    if (value && typeof value === 'object') return Object.values(value).flatMap(collect_strings);
    return [];
};

const contains_headers_key = (value) => {
    if (Array.isArray(value)) return value.some(contains_headers_key);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) => key.toLowerCase() === 'headers' || contains_headers_key(child));
};

// Every shipped mcp.json is secret-free: no headers, no environment placeholders,
// no bearer credential, and no LongMemory token. Host operators keep real secrets
// in their own stores, outside these files.
const validate_secret_free = (label, value) => {
    const errors = [];
    if (contains_headers_key(value)) errors.push(`${label} must not contain headers`);
    for (const string of collect_strings(value)) {
        if (string.includes('${')) errors.push(`${label} must not contain "\${" placeholders`);
        if (/\bbearer\s/i.test(string)) errors.push(`${label} must not contain a bearer credential`);
        if (longmemory_token.test(string)) errors.push(`${label} must not contain a LongMemory token`);
    }
    return errors;
};

const read_frontmatter = (text) => {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    if (!match) return { error: 'has no frontmatter' };
    try {
        const data = parse_yaml(match[1]);
        if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'frontmatter is not a mapping' };
        return { data };
    } catch (error) {
        return { error: `frontmatter is not valid YAML: ${error.message}` };
    }
};

const validate_skill = (label, text) => {
    const errors = [];
    if (/openclaw/i.test(text.split(/\r?\n/).slice(0, 20).join('\n'))) {
        errors.push(`${label} mentions openclaw in its first 20 lines`);
    }
    const { data, error } = read_frontmatter(text);
    if (error) {
        errors.push(`${label} ${error}`);
        return errors;
    }
    if (Object.hasOwn(data, 'metadata')) errors.push(`${label} must not contain a metadata block`);
    if (typeof data.name !== 'string' || !data.name.trim()) errors.push(`${label} is missing "name"`);
    if (typeof data.description !== 'string' || !data.description.trim()) errors.push(`${label} is missing "description"`);
    return errors;
};

const read_json_file = (repo_root, label, errors) => {
    const full_path = join(repo_root, label);
    if (!existsSync(full_path)) {
        errors.push(`${label} is missing`);
        return null;
    }
    try {
        const value = JSON.parse(readFileSync(full_path, 'utf8'));
        if (!is_record(value)) {
            errors.push(`${label} must be a JSON object`);
            return null;
        }
        return value;
    } catch (error) {
        errors.push(`${label} is not valid JSON: ${error.message}`);
        return null;
    }
};

export function validate_antigravity_plugin({ repo_root }) {
    const errors = [];
    const dir = antigravity_plugin_dir;
    const plugin_label = `${dir}/plugin.json`;
    const mcp_label = `${dir}/mcp_config.json`;
    const plugin_dir = resolve(repo_root, dir);

    for (const [label, allow_empty] of [
        [`${dir}/rules/AGENTS.md`, false],
        [`${dir}/README.md`, false],
        [`${dir}/skills/longmemory/SKILL.md`, true],
    ]) {
        const full_path = join(repo_root, label);
        if (!existsSync(full_path)) {
            errors.push(`${label} is missing`);
            continue;
        }
        if (!allow_empty && !readFileSync(full_path, 'utf8').trim()) errors.push(`${label} must not be empty`);
    }

    const plugin = read_json_file(repo_root, plugin_label, errors);
    if (plugin) {
        if (plugin.$schema !== antigravity_plugin_schema) {
            errors.push(`${plugin_label} must declare "$schema": "${antigravity_plugin_schema}"`);
        }
        if (typeof plugin.name !== 'string' || !kebab_name.test(plugin.name)) {
            errors.push(`${plugin_label} "name" must be lowercase kebab-case (got ${JSON.stringify(plugin.name)})`);
        }
        for (const key of ['displayName', 'description', 'version']) {
            if (typeof plugin[key] !== 'string' || !plugin[key].trim()) errors.push(`${plugin_label} is missing "${key}"`);
        }
        for (const key of Object.keys(plugin)) {
            if (!antigravity_plugin_keys.has(key)) errors.push(`${plugin_label} has unknown key "${key}"`);
        }
        if (plugin.logo === undefined) {
            errors.push(`${plugin_label} is missing "logo"`);
        } else if (typeof plugin.logo !== 'string' || !plugin.logo.trim()) {
            errors.push(`${plugin_label} "logo" must be a non-empty string`);
        } else {
            const logo = plugin.logo;
            const logo_path = resolve(plugin_dir, logo);
            const inside = logo_path === plugin_dir || logo_path.startsWith(plugin_dir + sep);
            if (logo.startsWith('/') || logo.includes('..') || !inside) {
                errors.push(`${plugin_label} "logo" must stay inside the plugin directory`);
            } else if (!antigravity_logo_extensions.has(extname(logo).toLowerCase())) {
                errors.push(`${plugin_label} "logo" must use an allowed image extension`);
            } else if (!existsSync(logo_path)) {
                errors.push(`${plugin_label} "logo" file is missing: ${logo}`);
            }
        }
        if (plugin.suggestedPrompts !== undefined) {
            const prompts = plugin.suggestedPrompts;
            if (!Array.isArray(prompts) || prompts.length < 1 || prompts.length > 3
                || prompts.some((prompt) => typeof prompt !== 'string' || !prompt.trim())) {
                errors.push(`${plugin_label} "suggestedPrompts" must be an array of 1-3 non-blank strings`);
            }
        }
        if (plugin.author === undefined) {
            errors.push(`${plugin_label} is missing "author"`);
        } else if (typeof plugin.author === 'string') {
            if (!plugin.author.trim()) errors.push(`${plugin_label} "author" must not be empty`);
        } else if (!is_record(plugin.author)) {
            errors.push(`${plugin_label} "author" must be a string or an object`);
        } else {
            if (typeof plugin.author.name !== 'string' || !plugin.author.name.trim()) errors.push(`${plugin_label} "author.name" is missing`);
            if (plugin.author.url !== undefined && (typeof plugin.author.url !== 'string' || !plugin.author.url.startsWith('https://'))) {
                errors.push(`${plugin_label} "author.url" must start with "https://"`);
            }
        }
        for (const key of ['homepage', 'repository', 'license']) {
            if (plugin[key] !== undefined && typeof plugin[key] !== 'string') errors.push(`${plugin_label} "${key}" must be a string`);
        }
        if (plugin.keywords !== undefined && (!Array.isArray(plugin.keywords) || plugin.keywords.some((keyword) => typeof keyword !== 'string'))) {
            errors.push(`${plugin_label} "keywords" must be an array of strings`);
        }
        if (plugin.disabled !== undefined && typeof plugin.disabled !== 'boolean') errors.push(`${plugin_label} "disabled" must be a boolean`);
        if (plugin.extensions !== undefined && !is_record(plugin.extensions)) errors.push(`${plugin_label} "extensions" must be an object`);
    }

    const mcp = read_json_file(repo_root, mcp_label, errors);
    if (mcp) {
        errors.push(...validate_secret_free(mcp_label, mcp));
        if (!is_record(mcp.mcpServers)) {
            errors.push(`${mcp_label} is missing an "mcpServers" object`);
        } else {
            const names = Object.keys(mcp.mcpServers);
            if (!names.includes('longmemory')) errors.push(`${mcp_label} is missing the "longmemory" server`);
            for (const name of names) {
                if (name !== 'longmemory') errors.push(`${mcp_label} must not contain the "${name}" server; only "longmemory" is allowed`);
            }
            const server = mcp.mcpServers.longmemory;
            if (server !== undefined) {
                if (!is_record(server)) {
                    errors.push(`${mcp_label} "longmemory" server must be an object`);
                } else {
                    if (server.command !== 'longmemory') errors.push(`${mcp_label} "longmemory" server must use the stdio command "longmemory"`);
                    if (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== 'string')) {
                        errors.push(`${mcp_label} "longmemory" server "args" must be an array of strings`);
                    } else if (server.args[0] !== 'mcp') {
                        errors.push(`${mcp_label} "longmemory" server "args" must start with "mcp"`);
                    }
                    if (server.env !== undefined && (!is_record(server.env) || Object.values(server.env).some((value) => typeof value !== 'string'))) {
                        errors.push(`${mcp_label} "longmemory" server "env" must be an object of strings`);
                    }
                    if (server.cwd !== undefined && typeof server.cwd !== 'string') errors.push(`${mcp_label} "longmemory" server "cwd" must be a string`);
                    if (server.timeoutSeconds !== undefined && (!Number.isInteger(server.timeoutSeconds) || server.timeoutSeconds < 1)) {
                        errors.push(`${mcp_label} "longmemory" server "timeoutSeconds" must be a positive integer`);
                    }
                    for (const key of Object.keys(server)) {
                        if (!antigravity_mcp_keys.has(key)) errors.push(`${mcp_label} "longmemory" server has unknown key "${key}"`);
                    }
                }
            }
        }
    }

    return [...new Set(errors)];
}

export function validate_kilo_package({ repo_root }) {
    const errors = [];
    const dir = kilo_package_dir;
    const package_label = `${dir}/package.json`;
    const config_label = `${dir}/kilo.json`;

    const manifest = read_json_file(repo_root, package_label, errors);
    if (manifest) {
        if (manifest.name !== '@caviraoss/kilo-longmemory') {
            errors.push(`${package_label} "name" must be "@caviraoss/kilo-longmemory"`);
        }
        if (manifest.type !== 'module') errors.push(`${package_label} must use "type": "module"`);
        const server_export = manifest.exports?.['./server'];
        const server_path = typeof server_export === 'string' ? server_export : server_export?.import;
        if (server_path !== './src/index.ts') {
            errors.push(`${package_label} must export "./server" from "./src/index.ts"`);
        }
        if (!Array.isArray(manifest.files) || !manifest.files.includes('src') || !manifest.files.includes('skills')) {
            errors.push(`${package_label} "files" must include "src" and "skills"`);
        }
        if (typeof manifest.engines?.opencode !== 'string' || !manifest.engines.opencode.startsWith('^7.8')) {
            errors.push(`${package_label} "engines.opencode" must start with "^7.8"`);
        }
        if (typeof manifest.peerDependencies?.['@kilocode/plugin'] !== 'string') {
            errors.push(`${package_label} is missing the "@kilocode/plugin" peer dependency`);
        }
    }

    for (const file of ['src/index.ts', 'src/context.ts', 'src/config.ts', 'README.md', 'LICENSE']) {
        const full_path = join(repo_root, dir, file);
        if (!existsSync(full_path)) {
            errors.push(`${dir}/${file} is missing`);
        } else if ((file === 'README.md' || file === 'LICENSE') && !readFileSync(full_path, 'utf8').trim()) {
            errors.push(`${dir}/${file} must not be empty`);
        }
    }

    const index_label = `${dir}/src/index.ts`;
    const index_path = join(repo_root, index_label);
    if (existsSync(index_path)) {
        const source = readFileSync(index_path, 'utf8');
        if (!/\bid\s*:\s*['"]longmemory['"]/.test(source)) errors.push(`${index_label} must declare id: 'longmemory'`);
        if (!/\bexport\s+default\b/.test(source)) errors.push(`${index_label} must have a default export`);
    }

    const config = read_json_file(repo_root, config_label, errors);
    if (config) {
        errors.push(...validate_secret_free(config_label, config));
        if (!is_record(config.mcp)) {
            errors.push(`${config_label} is missing an "mcp" object`);
        } else {
            if (Object.hasOwn(config.mcp, 'servers')) {
                errors.push(`${config_label} must define "mcp.longmemory" directly; "mcp.servers" is not a Kilo config shape`);
            }
            const server = config.mcp.longmemory;
            if (!is_record(server)) {
                errors.push(`${config_label} is missing the "mcp.longmemory" server`);
            } else {
                if (server.type !== 'local') errors.push(`${config_label} "mcp.longmemory.type" must be "local"`);
                if (!Array.isArray(server.command) || server.command[0] !== 'longmemory') {
                    errors.push(`${config_label} "mcp.longmemory.command" must start with "longmemory"`);
                }
                if (server.enabled !== true) errors.push(`${config_label} "mcp.longmemory.enabled" must be true`);
            }
        }
    }

    return [...new Set(errors)];
}

const workspace_simple_packs = [
    'integrations/windsurf-longmemory/mcp_config.json',
    'integrations/mcp-configs/cursor.json',
    'integrations/mcp-configs/windsurf.json',
];
const workspace_vscode_packs = [
    'integrations/copilot-longmemory/.vscode/mcp.json',
    'integrations/mcp-configs/vscode.json',
];

const contains_authorization_key = (value) => {
    if (Array.isArray(value)) return value.some(contains_authorization_key);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) => key.toLowerCase() === 'authorization' || contains_authorization_key(child));
};

const validate_workspace_server = (label, container, server) => {
    if (!is_record(server)) return [`${label} is missing the "longmemory" server`];
    const errors = [];
    if (container === 'servers' && server.type !== 'stdio') {
        errors.push(`${label} "longmemory.type" must be "stdio"`);
    }
    if (container === 'mcpServers' && server.type !== undefined && server.type !== 'stdio') {
        errors.push(`${label} "longmemory.type" must be "stdio" when set`);
    }
    if (server.command !== 'longmemory') errors.push(`${label} "longmemory.command" must be "longmemory"`);
    if (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== 'string')) {
        errors.push(`${label} "longmemory.args" must be an array of strings`);
    }
    return errors;
};

export function validate_workspace_packs({ repo_root }) {
    const errors = [];
    const packs = [
        ...workspace_vscode_packs.map((label) => ({ label, container: 'servers' })),
        ...workspace_simple_packs.map((label) => ({ label, container: 'mcpServers' })),
    ];
    for (const { label, container } of packs) {
        const config = read_json_file(repo_root, label, errors);
        if (!config) continue;
        errors.push(...validate_secret_free(label, config));
        if (contains_authorization_key(config)) errors.push(`${label} must not contain an authorization key`);
        const other = container === 'servers' ? 'mcpServers' : 'servers';
        if (Object.hasOwn(config, other)) {
            errors.push(`${label} must use the "${container}" container, not "${other}"`);
            continue;
        }
        if (!is_record(config[container])) {
            errors.push(`${label} is missing a "${container}" object`);
            continue;
        }
        errors.push(...validate_workspace_server(label, container, config[container].longmemory));
    }

    for (const [label, required] of [
        ['integrations/copilot-longmemory/README.md', null],
        ['integrations/windsurf-longmemory/README.md', null],
        ['integrations/copilot-longmemory/.github/instructions/longmemory.instructions.md', 'applyTo'],
        ['integrations/windsurf-longmemory/.windsurf/rules/longmemory.md', null],
        ['integrations/mcp-configs/README.md', null],
    ]) {
        const full_path = join(repo_root, label);
        if (!existsSync(full_path)) {
            errors.push(`${label} is missing`);
            continue;
        }
        const text = readFileSync(full_path, 'utf8');
        if (!text.trim()) {
            errors.push(`${label} must not be empty`);
            continue;
        }
        if (required) {
            const { data, error } = read_frontmatter(text);
            if (error) {
                errors.push(`${label} ${error}`);
            } else if (typeof data[required] !== 'string' || !data[required].trim()) {
                errors.push(`${label} is missing "${required}" frontmatter`);
            }
        }
    }

    return [...new Set(errors)];
}

export function validate_host_clis({ repo_root, which = find_executable, run = run_command }) {
    let agy;
    try {
        agy = which('agy');
    } catch (error) {
        return [`agy lookup failed: ${error.message}`];
    }
    if (!agy) return [];

    let result;
    try {
        result = run(agy, ['plugin', 'validate', '--strict', resolve(repo_root, antigravity_plugin_dir)]);
    } catch (error) {
        return [`agy plugin validate --strict failed: ${error.message}`];
    }
    if (!result || result.status === 0) return [];

    const output = [result.stdout, result.stderr]
        .filter((part) => typeof part === 'string' && part.trim())
        .join('\n')
        .trim()
        .slice(-2000);
    return [`agy plugin validate --strict failed${output ? `: ${output}` : ''}`];
}

export function check_skill_copies({ repo_root, targets = skill_targets }) {
    const source_file = join(repo_root, shared_skill);
    if (!existsSync(source_file)) return [`${shared_skill} is missing`];

    const source_bytes = readFileSync(source_file);
    const source = source_bytes.toString('utf8');
    const errors = validate_skill(shared_skill, source);
    for (const target of targets) {
        const target_file = join(repo_root, target);
        if (!existsSync(target_file)) {
            errors.push(`${target} is missing`);
            continue;
        }
        const copy_bytes = readFileSync(target_file);
        if (!copy_bytes.equals(source_bytes)) {
            errors.push(`${target} has drifted from ${shared_skill}; run node tools/sync-integrations.mjs`);
            continue;
        }
        errors.push(...validate_skill(target, copy_bytes.toString('utf8')));
    }
    return [...new Set(errors)];
}

export function validate_agent_plugin_bundle({ repo_root }) {
    const errors = [];
    const package_dir = join('integrations', 'longmemory-agent-plugin');
    const plugin_label = `${package_dir}/plugin.json`;
    const mcp_label = `${package_dir}/mcp.json`;

    const read_json = (label) => {
        const full_path = join(repo_root, label);
        if (!existsSync(full_path)) {
            errors.push(`${label} is missing`);
            return null;
        }
        try {
            const value = JSON.parse(readFileSync(full_path, 'utf8'));
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                errors.push(`${label} must be a JSON object`);
                return null;
            }
            return value;
        } catch (error) {
            errors.push(`${label} is not valid JSON: ${error.message}`);
            return null;
        }
    };

    const plugin = read_json(plugin_label);
    if (plugin) {
        if (plugin.$schema !== agent_plugin_schema) {
            errors.push(`${plugin_label} must declare "$schema": "${agent_plugin_schema}"`);
        }
        if (typeof plugin.name !== 'string' || !agent_plugin_name.test(plugin.name) || plugin.name.length > 64) {
            errors.push(`${plugin_label} "name" must be a lowercase plugin id matching the Agent Plugins pattern`);
        }
        for (const key of Object.keys(plugin)) {
            if (!agent_plugin_allowed.has(key)) errors.push(`${plugin_label} has unknown key "${key}"`);
        }
        for (const key of ['version', 'description', 'homepage', 'repository', 'license']) {
            if (plugin[key] !== undefined && typeof plugin[key] !== 'string') {
                errors.push(`${plugin_label} "${key}" must be a string`);
            }
        }
        if (plugin.author !== undefined) {
            if (!plugin.author || typeof plugin.author !== 'object' || Array.isArray(plugin.author)) {
                errors.push(`${plugin_label} "author" must be an object`);
            } else {
                for (const key of Object.keys(plugin.author)) {
                    if (!agent_author_allowed.has(key)) errors.push(`${plugin_label} "author" has unknown key "${key}"`);
                    else if (typeof plugin.author[key] !== 'string') errors.push(`${plugin_label} "author.${key}" must be a string`);
                }
            }
        }
        if (plugin.keywords !== undefined && (!Array.isArray(plugin.keywords) || plugin.keywords.some((keyword) => typeof keyword !== 'string'))) {
            errors.push(`${plugin_label} "keywords" must be an array of strings`);
        }
        if (plugin.extensions !== undefined) {
            if (!plugin.extensions || typeof plugin.extensions !== 'object' || Array.isArray(plugin.extensions)) {
                errors.push(`${plugin_label} "extensions" must be an object`);
            } else {
                for (const [namespace, value] of Object.entries(plugin.extensions)) {
                    if (!value || typeof value !== 'object' || Array.isArray(value)) {
                        errors.push(`${plugin_label} "extensions.${namespace}" must be an object`);
                    }
                }
            }
        }
    }

    const mcp = read_json(mcp_label);
    if (mcp) {
        if (mcp.$schema !== agent_mcp_schema) {
            errors.push(`${mcp_label} must declare "$schema": "${agent_mcp_schema}"`);
        }
        for (const key of Object.keys(mcp)) {
            if (!agent_mcp_allowed.has(key)) errors.push(`${mcp_label} has unknown key "${key}"`);
        }
        if (!mcp.mcpServers || typeof mcp.mcpServers !== 'object' || Array.isArray(mcp.mcpServers)) {
            errors.push(`${mcp_label} is missing an "mcpServers" object`);
        } else {
            const names = Object.keys(mcp.mcpServers);
            if (!names.includes('longmemory')) errors.push(`${mcp_label} is missing the "longmemory" server`);
            for (const name of names) {
                if (name !== 'longmemory') errors.push(`${mcp_label} must not contain the "${name}" server; only "longmemory" is allowed`);
            }
            const server = mcp.mcpServers.longmemory;
            if (server !== undefined) {
                if (!server || typeof server !== 'object' || Array.isArray(server)) {
                    errors.push(`${mcp_label} "longmemory" server must be an object`);
                } else {
                    if (server.type !== 'stdio') errors.push(`${mcp_label} "longmemory" server must use type "stdio"`);
                    if (typeof server.command !== 'string' || !server.command.trim()) {
                        errors.push(`${mcp_label} "longmemory" server must have a non-empty "command"`);
                    }
                    if (server.args !== undefined && (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== 'string'))) {
                        errors.push(`${mcp_label} "longmemory" server "args" must be an array of strings`);
                    }
                    if (server.env !== undefined && (!server.env || typeof server.env !== 'object' || Array.isArray(server.env) || Object.values(server.env).some((value) => typeof value !== 'string'))) {
                        errors.push(`${mcp_label} "longmemory" server "env" must be an object of strings`);
                    }
                    if (server.cwd !== undefined && (typeof server.cwd !== 'string' || !server.cwd.startsWith('./'))) {
                        errors.push(`${mcp_label} "longmemory" server "cwd" must start with "./"`);
                    }
                    for (const key of Object.keys(server)) {
                        if (key === 'headers') continue;
                        if (key === 'url') errors.push(`${mcp_label} "longmemory" server must not contain a url; only stdio is allowed`);
                        else if (!stdio_allowed.has(key)) errors.push(`${mcp_label} "longmemory" server has unknown key "${key}"`);
                    }
                    errors.push(...validate_secret_free(mcp_label, server));
                }
            }
        }
    }

    return errors;
}

export function validate_claude_marketplace({ repo_root }) {
    const errors = [];
    const label = '.claude-plugin/marketplace.json';
    const full_path = join(repo_root, label);
    if (!existsSync(full_path)) {
        errors.push(`${label} is missing`);
        return errors;
    }

    let marketplace;
    try {
        marketplace = JSON.parse(readFileSync(full_path, 'utf8'));
    } catch (error) {
        errors.push(`${label} is not valid JSON: ${error.message}`);
        return errors;
    }
    if (!marketplace || typeof marketplace !== 'object' || Array.isArray(marketplace)) {
        errors.push(`${label} must be a JSON object`);
        return errors;
    }
    if (typeof marketplace.name !== 'string' || !marketplace.name.trim()) errors.push(`${label} is missing "name"`);
    if (!marketplace.owner || typeof marketplace.owner !== 'object' || Array.isArray(marketplace.owner) || typeof marketplace.owner.name !== 'string' || !marketplace.owner.name.trim()) {
        errors.push(`${label} is missing an "owner.name"`);
    }
    if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
        errors.push(`${label} must have a non-empty "plugins" array`);
        return errors;
    }

    for (const [index, entry] of marketplace.plugins.entries()) {
        const entry_label = `${label} plugins[${index}]`;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            errors.push(`${entry_label} must be an object`);
            continue;
        }
        if (typeof entry.name !== 'string' || !entry.name.trim()) errors.push(`${entry_label} is missing "name"`);
        if (typeof entry.source !== 'string' || !entry.source.startsWith('./')) {
            errors.push(`${entry_label} "source" must be a relative path starting "./"`);
            continue;
        }
        if (entry.source.includes('..')) {
            errors.push(`${entry_label} "source" must not contain ".."`);
            continue;
        }
        const source_dir = join(repo_root, entry.source);
        if (!existsSync(source_dir)) {
            errors.push(`${entry_label} "source" does not resolve to an existing directory: ${entry.source}`);
            continue;
        }
        const plugin_file = join(source_dir, '.claude-plugin', 'plugin.json');
        if (!existsSync(plugin_file)) {
            errors.push(`${entry_label} "source" is missing .claude-plugin/plugin.json`);
            continue;
        }
        try {
            const plugin = JSON.parse(readFileSync(plugin_file, 'utf8'));
            if (plugin.name !== entry.name) {
                errors.push(`${entry_label} name "${entry.name}" does not match the plugin manifest name "${plugin.name}"`);
            }
        } catch (error) {
            errors.push(`${entry_label} plugin manifest is not valid JSON: ${error.message}`);
        }
    }

    return errors;
}

export function validate_integrations({ repo_root, host_clis = true }) {
    const errors = [];

    for (const relative_path of manifests) {
        const full_path = join(repo_root, relative_path);
        if (!existsSync(full_path)) {
            errors.push(`${relative_path} is missing`);
            continue;
        }
        let manifest;
        try {
            manifest = JSON.parse(readFileSync(full_path, 'utf8'));
        } catch (error) {
            errors.push(`${relative_path} is not valid JSON: ${error.message}`);
            continue;
        }
        if (!manifest.name) errors.push(`${relative_path} is missing "name"`);
        if (!manifest.version) errors.push(`${relative_path} is missing "version"`);
    }

    for (const relative_path of mcp_configs) {
        const full_path = join(repo_root, relative_path);
        if (!existsSync(full_path)) {
            errors.push(`${relative_path} is missing`);
            continue;
        }
        try {
            const config = JSON.parse(readFileSync(full_path, 'utf8'));
            errors.push(...validate_secret_free(relative_path, config));
            if (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
                errors.push(`${relative_path} is missing an "mcpServers" object`);
                continue;
            }
            if (!config.mcpServers.longmemory || typeof config.mcpServers.longmemory !== 'object') {
                errors.push(`${relative_path} is missing the "longmemory" server`);
            }
        } catch (error) {
            errors.push(`${relative_path} is not valid JSON: ${error.message}`);
        }
    }

    for (const relative_path of opencode_files) {
        if (!existsSync(join(repo_root, relative_path))) errors.push(`${relative_path} is missing`);
    }

    try {
        const manifest = JSON.parse(readFileSync(join(repo_root, 'integrations/opencode-longmemory/package.json'), 'utf8'));
        if (manifest.name !== '@caviraoss/opencode-longmemory') errors.push('integrations/opencode-longmemory/package.json has an unexpected "name"');
        if (manifest.exports?.['.'] !== './src/index.ts') errors.push('integrations/opencode-longmemory/package.json must export ./src/index.ts');
        if (!manifest.dependencies?.['@opencode/plugin']) errors.push('integrations/opencode-longmemory/package.json is missing @opencode/plugin');
    } catch (error) {
        errors.push(`integrations/opencode-longmemory/package.json cannot be validated: ${error.message}`);
    }

    try {
        const config = JSON.parse(readFileSync(join(repo_root, 'integrations/opencode-longmemory/opencode.jsonc'), 'utf8'));
        if (!Array.isArray(config.plugins) || !config.plugins.includes('./integrations/opencode-longmemory')) {
            errors.push('integrations/opencode-longmemory/opencode.jsonc must load the local plugin directory');
        }
        const server = config.mcp?.servers?.longmemory;
        if (!server || server.type !== 'local' || !Array.isArray(server.command) || server.command[0] !== 'longmemory') {
            errors.push('integrations/opencode-longmemory/opencode.jsonc must configure a local LongMemory MCP server');
        }
    } catch (error) {
        errors.push(`integrations/opencode-longmemory/opencode.jsonc cannot be validated: ${error.message}`);
    }

    errors.push(...check_skill_copies({ repo_root }));
    errors.push(...validate_agent_plugin_bundle({ repo_root }));
    errors.push(...validate_antigravity_plugin({ repo_root }));
    errors.push(...validate_kilo_package({ repo_root }));
    errors.push(...validate_workspace_packs({ repo_root }));
    if (host_clis) errors.push(...validate_host_clis({ repo_root }));
    errors.push(...validate_claude_marketplace({ repo_root }));
    return [...new Set(errors)];
}

const main = () => {
    const repo_root = fileURLToPath(new URL('..', import.meta.url));
    const errors = validate_integrations({ repo_root });
    if (errors.length) {
        console.error('integration:check failed:');
        for (const error of errors) console.error(`  - ${error}`);
        process.exit(1);
    }
    console.log(`integration:check: ${manifests.length + mcp_configs.length} manifest(s) valid.`);
};

if (is_direct_execution(import.meta.url)) main();
