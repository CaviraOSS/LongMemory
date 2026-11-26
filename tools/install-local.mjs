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
 *  file  : tools/install-local.mjs
 *  usage : installs the local LongMemory checkout and host integrations
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
    chmodSync,
    cpSync,
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import jsonc from 'jsonc-parser';

const { applyEdits, modify, parse: parse_jsonc, printParseErrorCode } = jsonc;

const shell_quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

const is_plain_object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// systemd quotes with its own parser, not the shell; paths it cannot represent must fail early.
const systemd_arg = (label, value) => {
    if (/['"\\\n\r%]/.test(value)) {
        throw new Error(`${label} contains characters systemd cannot represent safely: ${value}`);
    }
    return /\s/.test(value) ? `"${value}"` : value;
};

export function merge_opencode_config(config, plugin_path) {
    if (!is_plain_object(config)) {
        throw new Error('opencode config must be an object');
    }
    if (config.plugins !== undefined && !Array.isArray(config.plugins)) {
        throw new Error('opencode plugins must be an array');
    }
    if (config.mcp !== undefined && !is_plain_object(config.mcp)) {
        throw new Error('opencode mcp must be an object');
    }
    if (config.mcp?.servers !== undefined && !is_plain_object(config.mcp.servers)) {
        throw new Error('opencode mcp.servers must be an object');
    }
    const existing_server = config.mcp?.servers?.longmemory;
    if (existing_server !== undefined && !is_plain_object(existing_server)) {
        throw new Error('opencode mcp.servers.longmemory must be an object');
    }

    if (config.plugins === undefined) config.plugins = [];
    const added_plugin = !config.plugins.includes(plugin_path);
    if (added_plugin) config.plugins.push(plugin_path);

    if (config.mcp === undefined) config.mcp = {};
    if (config.mcp.servers === undefined) config.mcp.servers = {};
    const added_mcp = existing_server === undefined;
    if (added_mcp) {
        config.mcp.servers.longmemory = {
            type: 'local',
            command: ['longmemory', 'mcp', '--project', 'current'],
            codemode: false,
        };
    }
    return { config, added_plugin, added_mcp };
}

export const host_ids = ['claude', 'kilo', 'cursor', 'windsurf', 'antigravity', 'copilot'];

export function parse_hosts(value) {
    const hosts = String(value ?? '')
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean);
    const unique = [...new Set(hosts)];
    for (const host of unique) {
        if (!host_ids.includes(host)) {
            throw new Error(`unknown host "${host}"; expected one of ${host_ids.join(', ')}`);
        }
    }
    return unique;
}

export function resolve_install_mode({ hosts = null, all_hosts = false, team = null, token_file = null, space = null } = {}) {
    const selected = all_hosts ? [...host_ids] : hosts ?? [];
    if (all_hosts && hosts && hosts.length > 0) {
        throw new Error('use --hosts or --all-hosts, not both');
    }
    for (const host of selected) {
        if (!host_ids.includes(host)) throw new Error(`unknown host "${host}"; expected one of ${host_ids.join(', ')}`);
    }
    if (team === null) {
        if (token_file !== null) throw new Error('--token-file requires --team');
        if (space !== null) throw new Error('--space requires --team');
        return selected.length > 0 ? { mode: 'hosts', hosts: selected } : { mode: 'local', hosts: [] };
    }
    if (!token_file) throw new Error('--team requires --token-file');
    if (selected.length === 0) throw new Error('--team requires --hosts or --all-hosts');
    return { mode: 'team', hosts: selected, server_url: team, space };
}

export const kilo_mcp_server = () => ({
    type: 'local',
    command: ['longmemory', 'mcp', '--project', 'current'],
    enabled: true,
});

export function merge_simple_mcp_config(config, server) {
    if (!is_plain_object(config)) throw new Error('mcp config must be an object');
    if (config.mcpServers === undefined) config.mcpServers = {};
    if (!is_plain_object(config.mcpServers)) throw new Error('mcp config "mcpServers" must be an object');
    if (config.mcpServers.longmemory !== undefined && !is_plain_object(config.mcpServers.longmemory)) {
        throw new Error('mcp config "mcpServers.longmemory" must be an object');
    }
    const added = config.mcpServers.longmemory === undefined;
    if (added) config.mcpServers.longmemory = structuredClone(server);
    return { config, added };
}

export function merge_vscode_mcp_config(config, server) {
    if (!is_plain_object(config)) throw new Error('vscode mcp config must be an object');
    if (config.servers === undefined && config.mcpServers !== undefined) {
        throw new Error('vscode mcp config must use "servers", not "mcpServers"');
    }
    if (config.servers === undefined) config.servers = {};
    if (!is_plain_object(config.servers)) throw new Error('vscode mcp config "servers" must be an object');
    if (config.servers.longmemory !== undefined && !is_plain_object(config.servers.longmemory)) {
        throw new Error('vscode mcp config "servers.longmemory" must be an object');
    }
    const added = config.servers.longmemory === undefined;
    if (added) config.servers.longmemory = structuredClone(server);
    return { config, added };
}

const jsonc_options = { insertSpaces: true, tabSize: 2, eol: '\n' };

export function merge_kilo_jsonc(text, plugin_path) {
    const source = text ?? '';
    const parse_errors = [];
    const config = parse_jsonc(source || '{}', parse_errors);
    if (parse_errors.length > 0) {
        throw new Error(`kilo config is not valid JSON: ${printParseErrorCode(parse_errors[0].error)} at offset ${parse_errors[0].offset}`);
    }
    if (!is_plain_object(config)) throw new Error('kilo config must be an object');
    if (config.mcp !== undefined && !is_plain_object(config.mcp)) throw new Error('kilo config "mcp" must be an object');
    if (config.plugin !== undefined && !Array.isArray(config.plugin)) throw new Error('kilo config "plugin" must be an array');
    if (config.mcp?.longmemory !== undefined && !is_plain_object(config.mcp.longmemory)) {
        throw new Error('kilo config "mcp.longmemory" must be an object');
    }

    const added_mcp = config.mcp?.longmemory === undefined;
    let next = source;
    if (added_mcp) {
        next = applyEdits(next, modify(next, ['mcp', 'longmemory'], kilo_mcp_server(), jsonc_options));
    }

    const added_plugin = !Array.isArray(config.plugin) || !config.plugin.includes(plugin_path);
    if (added_plugin) {
        const path = Array.isArray(config.plugin) ? ['plugin', -1] : ['plugin'];
        const value = Array.isArray(config.plugin) ? plugin_path : [plugin_path];
        next = applyEdits(next, modify(next, path, value, jsonc_options));
    }

    return { text: next, changed: next !== source, added_mcp, added_plugin };
}

export const render_wrapper = (repo_root) => [
    '#!/bin/sh',
    `exec node ${shell_quote(`${repo_root}/dist/cli/index.js`)} "$@"`,
    '',
].join('\n');

export const render_server_env = ({ api_key, db_path, port }) => [
    `LONGMEMORY_API_KEY=${api_key}`,
    `LONGMEMORY_DB_PATH=${db_path}`,
    'LONGMEMORY_HOST=127.0.0.1',
    `LONGMEMORY_PORT=${port}`,
    '',
].join('\n');

export const render_systemd_unit = ({ wrapper_path, env_path }) => [
    '[Unit]',
    'Description=LongMemory local server',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    `EnvironmentFile=${systemd_arg('EnvironmentFile', env_path)}`,
    `ExecStart=${systemd_arg('ExecStart', wrapper_path)} serve --mcp-http`,
    'Restart=on-failure',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
].join('\n');

export const default_run = (command, args, options = {}) => {
    const result = spawnSync(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        encoding: 'utf8',
        shell: false,
        timeout: options.timeout ?? 0,
        maxBuffer: 64 * 1024 * 1024,
    });
    return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? (result.error?.message ?? ''),
        error: result.error?.code ?? null,
    };
};

const stamp = () => new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');

const snapshot = (path) => existsSync(path)
    ? { content: readFileSync(path, 'utf8'), mode: statSync(path).mode & 0o777 }
    : null;

const write_backup = (path, content, mode) => {
    const backup = `${path}.bak.${stamp()}`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(backup, content, { mode });
    chmodSync(backup, mode);
    return backup;
};

const resolve_write_target = (path) => {
    try {
        if (!lstatSync(path).isSymbolicLink()) return path;
    } catch (error) {
        if (error.code === 'ENOENT') return path;
        throw error;
    }
    try {
        return realpathSync(path);
    } catch {
        throw new Error(`${path} is a dangling symlink`);
    }
};

const atomic_write = (path, content, mode) => {
    const target = resolve_write_target(path);
    mkdirSync(dirname(target), { recursive: true });
    const temp = `${target}.tmp.${process.pid}.${Date.now()}`;
    try {
        writeFileSync(temp, content, { mode });
        chmodSync(temp, mode);
        renameSync(temp, target);
    } catch (error) {
        rmSync(temp, { force: true });
        throw error;
    }
};

const write_with_backup = (path, content, { mode = 0o644, preserve_mode = false } = {}) => {
    const existing = snapshot(path);
    const final_mode = preserve_mode && existing ? existing.mode : mode;
    if (existing?.content === content) {
        if (!preserve_mode && existing.mode !== final_mode) chmodSync(path, final_mode);
        return { changed: false, backup: null };
    }
    const backup = existing ? write_backup(path, existing.content, existing.mode) : null;
    atomic_write(path, content, final_mode);
    return { changed: true, backup };
};

const normalize_team_url = (value) => {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`invalid_server_url: ${value}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('invalid_server_url: server URL must use http or https');
    }
    if (url.username || url.password) throw new Error('invalid_server_url: server URL must not contain credentials');
    if (url.search) throw new Error('invalid_server_url: server URL must not contain a query');
    if (url.hash) throw new Error('invalid_server_url: server URL must not contain a fragment');
    let path = url.pathname.replace(/\/$/, '');
    path = path.replace(/\/mcp\/?$/, '');
    return `${url.origin}${path}`;
};

const read_installer_token = (path) => {
    let raw;
    try {
        raw = readFileSync(path, 'utf8');
    } catch (error) {
        throw new Error(`invalid_token: cannot read token file ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const token = raw.trim();
    if (!token) throw new Error(`invalid_token: token file is empty: ${path}`);
    if (/[\s\u0000-\u001f\u007f]/.test(token)) {
        throw new Error(`invalid_token: token file contains whitespace or control characters: ${path}`);
    }
    return token;
};

const space_ids = (spaces) => spaces
    .map((space) => typeof space === 'string' ? space : is_plain_object(space) && typeof space.id === 'string' ? space.id : null)
    .filter(Boolean);

const verify_team_server = async ({ server_url, token, space, fetch_impl }) => {
    let response;
    try {
        response = await fetch_impl(`${server_url}/v1/whoami`, {
            headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
        });
    } catch {
        throw new Error('server_unreachable: the LongMemory server is unreachable');
    }
    if (response.status === 401) throw new Error('authentication_failed: the server rejected the token');
    if (!response.ok) throw new Error(`server_error: the server returned ${response.status}`);

    let payload;
    try {
        payload = await response.json();
    } catch {
        throw new Error('server_error: invalid whoami response');
    }
    const data = is_plain_object(payload) && is_plain_object(payload.data) ? payload.data : null;
    if (!data || typeof data.user_id !== 'string' || !data.user_id.trim() || !Array.isArray(data.spaces)) {
        throw new Error('server_error: invalid whoami response');
    }
    if (space) {
        const available = space_ids(data.spaces);
        if (space.startsWith('team:') && !available.includes(space)) {
            throw new Error(`space_forbidden: ${space} is not accessible with this token`);
        }
        if (space === 'personal' && !available.includes('personal')) {
            throw new Error('space_forbidden: personal space is not accessible with this token');
        }
        if (space === 'all' && available.length === 0) {
            throw new Error('space_forbidden: no accessible spaces for this token');
        }
    }
    return data;
};

const read_json_or_empty = (path) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
const json_document = (value) => `${JSON.stringify(value, null, 2)}\n`;
const stdio_server = { command: 'longmemory', args: ['mcp', '--project', 'current'] };
const vscode_stdio_server = { type: 'stdio', ...stdio_server };

export function install_claude_host({ root, run, log, dry_run }) {
    if (dry_run) {
        return [`dry-run: would add the Claude marketplace ${root} when absent and install longmemory@longmemory`];
    }
    const listed = run('claude', ['plugin', 'marketplace', 'list']);
    if (listed.error === 'ENOENT') {
        return ['warning: claude CLI not found; install the marketplace manually'];
    }
    if (listed.code !== 0) throw new Error(listed.stderr || listed.stdout || 'claude plugin marketplace list failed');
    const root_listed = (listed.stdout ?? '')
        .split('\n')
        .some((line) => line.trimEnd().endsWith(` ${root}`) || line.trimEnd() === root);
    if (!root_listed) {
        const added = run('claude', ['plugin', 'marketplace', 'add', root]);
        if (added.code !== 0) throw new Error(added.stderr || added.stdout || 'claude marketplace add failed');
    }
    const installed = run('claude', ['plugin', 'install', 'longmemory@longmemory']);
    if (installed.code !== 0) throw new Error(installed.stderr || installed.stdout || 'claude plugin install failed');
    return [`Claude plugin: longmemory@longmemory installed from ${root}`];
}

export function install_kilo_host({ root, config_home, apply, log, dry_run }) {
    const plugin_source = join(root, 'integrations', 'kilo-longmemory', 'src', 'index.ts');
    if (!existsSync(plugin_source)) throw new Error(`Kilo plugin source is missing at ${plugin_source}`);
    const config_dir = join(config_home, 'kilo');
    const jsonc_path = join(config_dir, 'kilo.jsonc');
    const json_path = join(config_dir, 'kilo.json');
    const path = existsSync(jsonc_path) ? jsonc_path : existsSync(json_path) ? json_path : json_path;
    const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const plugin_entry = pathToFileURL(plugin_source).href;
    const merged = merge_kilo_jsonc(text, plugin_entry);
    if (dry_run) {
        return [`dry-run: would merge ${path} (MCP ${merged.added_mcp ? 'add' : 'unchanged'}, plugin ${merged.added_plugin ? 'add' : 'unchanged'})`];
    }
    apply(path, merged.text, { mode: 0o644, preserve_mode: true });
    return [
        `Kilo config: ${path} (MCP ${merged.added_mcp ? 'added' : 'kept'}, plugin ${merged.added_plugin ? 'added' : 'kept'})`,
        `Kilo plugin entry: ${plugin_entry}`,
    ];
}

export function install_cursor_host({ root, home, apply, log, dry_run }) {
    const path = join(home, '.cursor', 'mcp.json');
    const notes = [];
    const config = read_json_or_empty(path);
    const merged = merge_simple_mcp_config(config, stdio_server);
    if (dry_run) {
        notes.push(`dry-run: would merge ${path} (${merged.added ? 'add' : 'unchanged'})`);
    } else if (merged.added) {
        apply(path, json_document(config), { mode: 0o644, preserve_mode: true });
        notes.push(`Cursor config: ${path} (added)`);
    } else {
        notes.push(`Cursor config: ${path} (kept)`);
    }
    notes.push(`Cursor portable bundle: ${join(root, 'integrations', 'longmemory-agent-plugin')} (one-time Customize -> Plugins install)`);
    return notes;
}

export function install_windsurf_host({ root, config_home, workspace, apply, project_level, log, dry_run }) {
    const path = join(config_home, 'devin', 'mcp_config.json');
    const config = read_json_or_empty(path);
    const merged = merge_simple_mcp_config(config, stdio_server);
    const notes = [];
    if (dry_run) {
        notes.push(`dry-run: would merge ${path} (${merged.added ? 'add' : 'unchanged'})`);
        if (project_level) notes.push(`dry-run: would write ${join(workspace, '.windsurf', 'rules', 'longmemory.md')}`);
        return notes;
    }
    if (merged.added) {
        apply(path, json_document(config), { mode: 0o644, preserve_mode: true });
        notes.push(`Windsurf config: ${path} (added)`);
    } else {
        notes.push(`Windsurf config: ${path} (kept)`);
    }
    if (project_level) {
        const source = join(root, 'integrations', 'windsurf-longmemory', '.windsurf', 'rules', 'longmemory.md');
        if (!existsSync(source)) throw new Error(`Windsurf rule template is missing at ${source}`);
        const target = join(workspace, '.windsurf', 'rules', 'longmemory.md');
        apply(target, readFileSync(source, 'utf8'), { mode: 0o644 });
        notes.push(`Windsurf project rule: ${target}`);
    }
    return notes;
}

const copy_antigravity_plugin = ({ root, home }) => {
    const source = join(root, 'integrations', 'antigravity-longmemory');
    if (!existsSync(source)) throw new Error(`Antigravity plugin is missing at ${source}`);
    const target = join(home, '.gemini', 'config', 'plugins', 'longmemory');
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    if (existsSync(target)) renameSync(target, `${target}.bak.${stamp()}`);
    cpSync(source, target, { recursive: true, force: true });
    return target;
};

export function install_antigravity_host({ root, home, run, log, dry_run }) {
    const source = join(root, 'integrations', 'antigravity-longmemory');
    if (dry_run) {
        return [`dry-run: would validate and install ${source} with agy, or copy it to ${join(home, '.gemini', 'config', 'plugins', 'longmemory')}`];
    }
    const validated = run('agy', ['plugin', 'validate', '--strict', source]);
    if (validated.error === 'ENOENT') {
        const target = copy_antigravity_plugin({ root, home });
        return [`warning: agy CLI not found; copied the Antigravity plugin to ${target}`];
    }
    if (validated.code !== 0) throw new Error(validated.stderr || validated.stdout || 'agy plugin validate --strict failed');
    const installed = run('agy', ['plugin', 'install', source]);
    if (installed.error === 'ENOENT') {
        const target = copy_antigravity_plugin({ root, home });
        return [`warning: agy CLI not found; copied the Antigravity plugin to ${target}`];
    }
    if (installed.code !== 0) throw new Error(installed.stderr || installed.stdout || 'agy plugin install failed');
    return [`Antigravity plugin: installed from ${source}`];
}

export function install_copilot_host({ config_home, workspace, apply, run, project_level, log, dry_run }) {
    const path = join(config_home, 'Code', 'User', 'mcp.json');
    const project_path = join(workspace ?? '', '.vscode', 'mcp.json');
    const notes = [];
    if (dry_run) {
        notes.push(`dry-run: would run code --add-mcp for longmemory, or merge ${path} when code is absent`);
        if (project_level) notes.push(`dry-run: would merge ${project_path} (add)`);
        return notes;
    }

    const cli = run('code', ['--add-mcp', JSON.stringify({ name: 'longmemory', ...stdio_server })]);
    if (cli.error === 'ENOENT') {
        const config = read_json_or_empty(path);
        const merged = merge_vscode_mcp_config(config, vscode_stdio_server);
        apply(path, json_document(config), { mode: 0o644, preserve_mode: true });
        notes.push(`warning: code CLI not found; merged ${path} instead`);
        notes.push(`VS Code config: ${path} (${merged.added ? 'added' : 'kept'})`);
    } else if (cli.code !== 0) {
        throw new Error(cli.stderr || cli.stdout || 'code --add-mcp failed');
    } else {
        notes.push('VS Code MCP server: added with code --add-mcp');
    }

    if (project_level) {
        const config = read_json_or_empty(project_path);
        const merged = merge_vscode_mcp_config(config, vscode_stdio_server);
        apply(project_path, json_document(config), { mode: 0o644, preserve_mode: true });
        notes.push(`VS Code project config: ${project_path} (${merged.added ? 'added' : 'kept'})`);
    }
    return notes;
}

export async function apply_hosts({ mode, hosts, root, home, env, run, log, dry_run, apply, project_level, workspace }) {
    const config_home = env.XDG_CONFIG_HOME || join(home, '.config');
    const notes = [];
    for (const host of hosts) {
        if (host === 'claude') notes.push(...install_claude_host({ root, run, log, dry_run }));
        else if (host === 'kilo') notes.push(...install_kilo_host({ root, config_home, apply, log, dry_run }));
        else if (host === 'cursor') notes.push(...install_cursor_host({ root, home, apply, log, dry_run }));
        else if (host === 'windsurf') notes.push(...install_windsurf_host({ root, config_home, workspace, apply, project_level, log, dry_run }));
        else if (host === 'antigravity') notes.push(...install_antigravity_host({ root, home, run, log, dry_run }));
        else if (host === 'copilot') notes.push(...install_copilot_host({ config_home, workspace, apply, run, project_level, log, dry_run }));
        else throw new Error(`unknown host "${host}"`);
    }
    return notes;
}

export async function install({
    repo_root,
    env = process.env,
    run = default_run,
    log = console.log,
    dry_run = false,
    hosts = null,
    all_hosts = false,
    team = null,
    token_file = null,
    space = null,
    project_level = false,
    workspace = null,
    fetch: fetch_impl = fetch,
}) {
    const changed = [];

    let mode;
    try {
        mode = resolve_install_mode({ hosts, all_hosts, team, token_file, space });
    } catch (error) {
        log(`install failed at flags: ${error.message}`);
        return { ok: false, changed };
    }

    // project-level / workspace validation before any write
    if (project_level) {
        if (mode.hosts.length === 0) {
            log('install failed at flags: --project-level requires a host selection (--hosts or --all-hosts)');
            return { ok: false, changed };
        }
        if (!workspace) workspace = resolve(process.cwd());
        if (!existsSync(workspace)) {
            log(`install failed at flags: workspace path does not exist: ${workspace}`);
            return { ok: false, changed };
        }
    }
    if (workspace && !project_level) {
        log('install failed at flags: --workspace requires --project-level');
        return { ok: false, changed };
    }

    if (!env.HOME) {
        log('install failed at preflight: HOME is not set');
        return { ok: false, changed };
    }

    const root = resolve(repo_root);
    const home = env.HOME;
    const config_home = env.XDG_CONFIG_HOME || join(home, '.config');
    const data_home = env.XDG_DATA_HOME || join(home, '.local', 'share');
    const codex_home = env.CODEX_HOME || join(home, '.codex');
    const bin_dir = join(home, '.local', 'bin');
    const wrapper_path = join(bin_dir, 'longmemory');
    const env_path = join(config_home, 'longmemory', 'server.env');
    const unit_path = join(config_home, 'systemd', 'user', 'longmemory.service');
    const opencode_dir = join(config_home, 'opencode');
    const opencode_path = join(opencode_dir, 'opencode.json');
    const opencode_jsonc_path = join(opencode_dir, 'opencode.jsonc');
    const db_path = join(data_home, 'longmemory', 'shared.db');
    const plugin_path = join(root, 'integrations', 'opencode-longmemory');
    const codex_config_path = join(codex_home, 'config.toml');
    let step = 'preflight';
    let merged;
    let codex_available = false;
    let codex_added_plugin = false;
    let systemd_available = true;

    const apply = (path, content, options) => {
        const result = write_with_backup(path, content, options);
        if (result.changed) changed.push({ path, backup: result.backup });
    };

    const report_changes = () => {
        for (const item of changed) {
            log(`changed: ${item.path}${item.backup ? ` (backup ${item.backup})` : ''}`);
        }
    };

    try {
        const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
        if (manifest.name !== 'longmemory') {
            throw new Error('repository package name is not longmemory');
        }
        if (Number(process.versions.node.split('.')[0]) < 20) {
            throw new Error(`Node 20+ required (found ${process.versions.node})`);
        }
        // OpenCode plugin check only in local mode
        if (mode.mode === 'local') {
            if (!existsSync(join(plugin_path, 'package.json'))) {
                throw new Error(`OpenCode plugin package missing at ${plugin_path}`);
            }
            if (!existsSync(opencode_path) && existsSync(opencode_jsonc_path)) {
                throw new Error(`found ${opencode_jsonc_path}; rename it to opencode.json or add the LongMemory entry manually`);
            }
            if (existsSync(opencode_path) && existsSync(opencode_jsonc_path)) {
                log(`warning: ${opencode_jsonc_path} also exists and may take precedence`);
            }
        }

        step = 'build';
        if (dry_run) {
            log('dry-run: would install dependencies and build the CLI');
        } else {
            const has_pnpm = run('pnpm', ['--version'], { cwd: root }).code === 0;
            const pnpm = has_pnpm
                ? (args) => run('pnpm', args, { cwd: root })
                : (args) => run('npm', ['exec', '--yes', '--package=pnpm@11.5.2', '--', 'pnpm', ...args], { cwd: root });
            const installed = pnpm(['install', '--frozen-lockfile']);
            if (installed.code !== 0) {
                throw new Error(installed.stderr || installed.stdout || 'pnpm install failed');
            }
            const built = pnpm(['build']);
            if (built.code !== 0) {
                throw new Error(built.stderr || built.stdout || 'pnpm build failed');
            }
            if (!existsSync(join(root, 'dist', 'cli', 'index.js'))) {
                throw new Error('build did not produce dist/cli/index.js');
            }
        }

        step = 'wrapper';
        if (dry_run) {
            log(`dry-run: would write ${wrapper_path}`);
        } else {
            apply(wrapper_path, render_wrapper(root), { mode: 0o755 });
        }
        if (!(env.PATH ?? '').split(':').filter(Boolean).includes(bin_dir)) {
            log(`warning: ${bin_dir} is not on PATH`);
        }

        if (mode.mode === 'team') {
            step = 'team verification';
            const token = read_installer_token(token_file);
            const server_url = normalize_team_url(team);
            const client_config_path = join(config_home, 'longmemory', 'client.json');
            if (dry_run) {
                log(`dry-run: would verify token with ${server_url}/v1/whoami`);
                log(`dry-run: would write ${client_config_path} (0600)`);
            } else {
                try {
                    const whoami = await verify_team_server({ server_url, token, space, fetch_impl });
                    // write client config
                    const client_config = {
                        server_url,
                        token,
                        space: space ?? whoami.write_space?.id ?? null,
                        project_id: null,
                    };
                    mkdirSync(dirname(client_config_path), { recursive: true, mode: 0o700 });
                    chmodSync(dirname(client_config_path), 0o700);
                    apply(client_config_path, `${JSON.stringify(client_config, null, 2)}\n`, { mode: 0o600 });
                    log(`Client config: ${client_config_path} (0600)`);
                } catch (error) {
                    log(`install failed at team verification: ${error.message}`);
                    return { ok: false, changed };
                }
            }
        } else if (mode.mode === 'local') {
            step = 'server artifacts';
            if (!dry_run) {
                const probe = run('systemctl', ['--user', 'show-environment'], { timeout: 15000 });
                systemd_available = probe.code === 0;
                if (!systemd_available) {
                    log('warning: systemd --user unavailable; skipping the shared server unit');
                }
            }
            let api_key = '';
            if (existsSync(env_path)) {
                const match = readFileSync(env_path, 'utf8').match(/^LONGMEMORY_API_KEY=(.+)$/m);
                if (match) api_key = match[1].trim();
            }
            if (!api_key) api_key = randomBytes(32).toString('base64url');
            if (dry_run) {
                log(`dry-run: would write ${env_path} and the shared server unit`);
            } else {
                mkdirSync(dirname(db_path), { recursive: true, mode: 0o700 });
                chmodSync(dirname(db_path), 0o700);
                apply(env_path, render_server_env({ api_key, db_path, port: 7331 }), { mode: 0o600 });
                if (systemd_available) {
                    apply(unit_path, render_systemd_unit({ wrapper_path, env_path }), { mode: 0o644 });
                }
            }

            step = 'opencode';
            const opencode = existsSync(opencode_path)
                ? JSON.parse(readFileSync(opencode_path, 'utf8'))
                : { $schema: 'https://opencode.ai/config.json' };
            merged = merge_opencode_config(opencode, plugin_path);
            if (dry_run) {
                log(`dry-run: would merge ${opencode_path} (plugin ${merged.added_plugin ? 'add' : 'kept'}, MCP ${merged.added_mcp ? 'add' : 'kept'})`);
            } else {
                apply(opencode_path, `${JSON.stringify(opencode, null, 2)}\n`, {
                    mode: 0o644,
                    preserve_mode: true,
                });
            }

            step = 'codex';
            if (dry_run) {
                log('dry-run: would register the Codex marketplace and install the plugin');
            } else {
                const version = run('codex', ['--version'], { timeout: 30000 });
                if (version.code !== 0) {
                    if (version.error === 'ENOENT') {
                        log('warning: codex CLI not found; skipping Codex plugin');
                    } else {
                        throw new Error(version.stderr || version.stdout || 'codex --version failed');
                    }
                } else {
                    codex_available = true;
                    const codex_before = snapshot(codex_config_path);
                    const plugin_marker = /^\[plugins\."longmemory@longmemory"\]$/m;
                    const record_codex_change = () => {
                        const codex_after = snapshot(codex_config_path);
                        if (codex_after?.content === codex_before?.content) return;
                        const backup = codex_before
                            ? write_backup(codex_config_path, codex_before.content, codex_before.mode)
                            : null;
                        changed.push({ path: codex_config_path, backup });
                    };

                    try {
                        const marketplaces = run('codex', ['plugin', 'marketplace', 'list'], { timeout: 60000 });
                        const listed = marketplaces.code === 0 && marketplaces.stdout
                            .split('\n')
                            .some((line) => line.trimEnd().endsWith(` ${root}`) || line.trimEnd() === root);
                        if (!listed) {
                            const added = run('codex', ['plugin', 'marketplace', 'add', root], { timeout: 120000 });
                            if (added.code !== 0) {
                                throw new Error(added.stderr || added.stdout || 'codex marketplace add failed');
                            }
                        }

                        if (!plugin_marker.test(codex_before?.content ?? '')) {
                            const added = run('codex', ['plugin', 'add', 'longmemory@longmemory', '--json'], { timeout: 120000 });
                            if (added.code !== 0) {
                                throw new Error(added.stderr || added.stdout || 'codex plugin add failed');
                            }
                            codex_added_plugin = true;
                        }

                        const verified_marketplaces = run('codex', ['plugin', 'marketplace', 'list'], { timeout: 60000 });
                        const still_listed = verified_marketplaces.code === 0 && verified_marketplaces.stdout
                            .split('\n')
                            .some((line) => line.trimEnd().endsWith(` ${root}`) || line.trimEnd() === root);
                        const codex_after = snapshot(codex_config_path);
                        if (!still_listed || !plugin_marker.test(codex_after?.content ?? '')) {
                            throw new Error('codex config verification failed');
                        }
                    } finally {
                        record_codex_change();
                    }
                }
            }
        }

        if (mode.hosts.length > 0) {
            step = 'hosts';
            const host_notes = await apply_hosts({
                mode: mode.mode,
                hosts: mode.hosts,
                root,
                home,
                env,
                run,
                log,
                dry_run,
                apply,
                project_level,
                workspace,
            });
            for (const note of host_notes) log(note);
        }

        if (dry_run) {
            log(`dry-run complete for ${root}; no files changed`);
        } else if (mode.mode === 'local') {
            step = 'verification';
            const help = run(wrapper_path, ['--help']);
            if (help.code !== 0) {
                throw new Error(help.stderr || help.stdout || 'longmemory --help failed');
            }
            const smoke_env = {};
            for (const [key, value] of Object.entries(env)) {
                if (!key.startsWith('LONGMEMORY_')) smoke_env[key] = value;
            }
            const temp = mkdtempSync(join(tmpdir(), 'longmemory-install-'));
            try {
                const smoke_db = join(temp, 'project.db');
                const init = run(wrapper_path, ['init', '--db', smoke_db], { cwd: temp, env: smoke_env });
                if (init.code !== 0) {
                    throw new Error(init.stderr || init.stdout || 'smoke init failed');
                }
                const context = run(wrapper_path, ['project', 'context', 'installer smoke', '--json', '--dry-run', '--db', smoke_db], {
                    cwd: temp,
                    env: smoke_env,
                });
                if (context.code !== 0) {
                    throw new Error(context.stderr || context.stdout || 'smoke context failed');
                }
                if (JSON.parse(context.stdout).ok !== true) {
                    throw new Error('smoke context did not return ok');
                }
            } finally {
                rmSync(temp, { recursive: true, force: true });
            }
            const verified = JSON.parse(readFileSync(opencode_path, 'utf8'));
            if (!verified.plugins?.includes(plugin_path) || !is_plain_object(verified.mcp?.servers?.longmemory)) {
                throw new Error('opencode config verification failed');
            }

            log(`LongMemory installed from ${root}`);
            log(`CLI: ${wrapper_path}`);
            log(`OpenCode config: ${opencode_path} (plugin ${merged.added_plugin ? 'added' : 'kept'}, MCP ${merged.added_mcp ? 'added' : 'kept'})`);
            if (codex_available) {
                log(`Codex plugin: ${codex_added_plugin ? 'installed' : 'already present'}`);
            } else {
                log('Codex plugin: skipped (CLI not found)');
            }
            log(`server key: ${env_path} (not shown)`);
            log(systemd_available
                ? `shared server unit: ${unit_path} (disabled)`
                : 'shared server unit: skipped (systemd --user unavailable)');
            report_changes();
            log('Restart OpenCode and Codex, then run `longmemory init` once per workspace.');
        } else {
            log(`LongMemory installed from ${root} (${mode.mode} mode)`);
            log(`CLI: ${wrapper_path}`);
            if (mode.mode === 'team') {
                const client_config_path = join(config_home, 'longmemory', 'client.json');
                log(`Client config: ${client_config_path} (0600)`);
            }
            report_changes();
        }
        return { ok: true, changed };
    } catch (error) {
        log(`install failed at ${step}: ${error instanceof Error ? error.message : String(error)}`);
        report_changes();
        if (changed.length > 0) {
            log('roll back by restoring the listed backups and removing files created by this run');
        }
        return { ok: false, changed };
    }
}

const help_text = `LongMemory local installer

Usage: npm run install:local -- [options]

Options:
  --hosts <list>        comma-separated host ids (claude,kilo,cursor,windsurf,antigravity,copilot)
  --all-hosts           configure every host
  --team <url>          team server URL (requires --token-file and --hosts/--all-hosts)
  --token-file <path>   path to bearer token file (requires --team)
  --space <space>       space id for team mode (personal, team:<id>, all)
  --project-level       write project-level templates for selected hosts
  --workspace <path>    workspace root for --project-level (default: cwd)
  --dry-run             report planned changes without writing anything
  --help                show this help

Modes:
  (no flags)            today's OpenCode + Codex install with local server artifacts
  --hosts <list>        local stdio setup for selected hosts
  --all-hosts           every host above
  --team <url>          verify token, write 0600 client config, configure selected hosts
                        requires --token-file and --hosts/--all-hosts

Hosts:
  claude                marketplace + plugin install (CLI optional)
  kilo                  merge kilo.json(c) with mcp.longmemory + file:// plugin entry
  cursor                merge ~/.cursor/mcp.json (mcpServers container)
  windsurf              merge ~/.config/devin/mcp_config.json; project-level -> .windsurf/rules/
  antigravity           agy plugin install; fallback copy to ~/.gemini/config/plugins/longmemory
  copilot               code --add-mcp; fallback merge ~/.config/Code/User/mcp.json

Each workspace still needs one explicit \`longmemory init\`.
`;

const parse_flags = (args) => {
    const flags = { hosts: null, all_hosts: false, team: null, token_file: null, space: null, project_level: false, workspace: null, dry_run: false, help: false };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help') flags.help = true;
        else if (arg === '--dry-run') flags.dry_run = true;
        else if (arg === '--all-hosts') flags.all_hosts = true;
        else if (arg === '--project-level') flags.project_level = true;
        else if (arg === '--hosts') {
            if (i + 1 >= args.length) throw new Error('--hosts requires a value');
            flags.hosts = args[++i];
        } else if (arg === '--team') {
            if (i + 1 >= args.length) throw new Error('--team requires a value');
            flags.team = args[++i];
        } else if (arg === '--token-file') {
            if (i + 1 >= args.length) throw new Error('--token-file requires a value');
            flags.token_file = args[++i];
        } else if (arg === '--space') {
            if (i + 1 >= args.length) throw new Error('--space requires a value');
            flags.space = args[++i];
        } else if (arg === '--workspace') {
            if (i + 1 >= args.length) throw new Error('--workspace requires a value');
            flags.workspace = args[++i];
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    }
    return flags;
};

const invoked_directly = process.argv[1] !== undefined
    && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invoked_directly) {
    const args = process.argv.slice(2);
    let flags;
    try {
        flags = parse_flags(args);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 2;
    }
    if (!flags && !process.exitCode) {
        console.error('usage: npm run install:local -- [--help]');
        process.exitCode = 2;
    } else if (flags.help) {
        console.log(help_text);
    } else {
        const repo_root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
        const result = await install({ repo_root, ...flags });
        process.exitCode = result.ok ? 0 : 1;
    }
}
