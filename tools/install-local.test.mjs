import test from 'node:test';
import assert from 'node:assert/strict';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    default_run,
    host_ids,
    install,
    kilo_mcp_server,
    merge_kilo_jsonc,
    merge_opencode_config,
    merge_simple_mcp_config,
    merge_vscode_mcp_config,
    parse_hosts,
    render_server_env,
    render_systemd_unit,
    render_wrapper,
    resolve_install_mode,
} from './install-local.mjs';

const plugin = '/path with spaces/longmemory/integrations/opencode-longmemory';

const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });

const make_repo = () => {
    const repo = mkdtempSync(join(tmpdir(), 'lm repo with spaces-'));
    mkdirSync(join(repo, 'dist', 'cli'), { recursive: true });
    mkdirSync(join(repo, 'integrations', 'opencode-longmemory'), { recursive: true });
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'longmemory', version: '1.0.0' }));
    writeFileSync(join(repo, 'integrations', 'opencode-longmemory', 'package.json'), '{}');
    writeFileSync(join(repo, 'dist', 'cli', 'index.js'), '#!/usr/bin/env node\n');
    return repo;
};

const make_home = () => mkdtempSync(join(tmpdir(), 'lm-home-'));

const make_env = (home) => ({
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    PATH: process.env.PATH,
});

const host_env = (home) => ({ ...make_env(home), PATH: '/usr/bin:/bin' });

const make_runner = ({ repo, home, state = {}, intercept } = {}) => (command, args, options = {}) => {
    if (intercept) {
        const result = intercept(command, args, options);
        if (result !== undefined) return result;
    }
    if (command === 'codex') {
        const config = join(home, '.codex', 'config.toml');
        if (args[0] === '--version') return ok('codex-cli 1.0.0');
        if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'list') {
            return ok(state.marketplace ? `longmemory              ${repo}\n` : '');
        }
        if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
            state.marketplace = true;
            state.marketplace_calls = (state.marketplace_calls ?? 0) + 1;
            return ok();
        }
        if (args[0] === 'plugin' && args[1] === 'add') {
            mkdirSync(join(home, '.codex'), { recursive: true });
            const before = existsSync(config) ? readFileSync(config, 'utf8') : '';
            writeFileSync(config, `${before}[plugins."longmemory@longmemory"]\nenabled = true\n`);
            state.plugin_calls = (state.plugin_calls ?? 0) + 1;
            return ok('{}');
        }
        return ok();
    }
    if (args[0] === 'project' && args[1] === 'context') return ok('{"ok":true}');
    return ok();
};

const backups_of = (path) => {
    const dir = join(path, '..');
    if (!existsSync(dir)) return [];
    const base = path.slice(dir.length + 1);
    return readdirSync(dir).filter((name) => name.startsWith(`${base}.bak.`));
};

test('merge adds the plugin and local MCP without touching existing entries', async () => {
    const existing = {
        $schema: 'https://opencode.ai/config.json',
        plugins: ['superpowers@git+https://example'],
        mcp: { servers: { context7: { type: 'remote', url: 'https://example/mcp' } } },
    };
    const { config, added_plugin, added_mcp } = merge_opencode_config(existing, plugin);
    assert.equal(added_plugin, true);
    assert.equal(added_mcp, true);
    assert.deepEqual(config.plugins, ['superpowers@git+https://example', plugin]);
    assert.deepEqual(config.mcp.servers.context7, existing.mcp.servers.context7);
    assert.deepEqual(config.mcp.servers.longmemory, {
        type: 'local',
        command: ['longmemory', 'mcp', '--project', 'current'],
        codemode: false,
    });
});

test('merge is idempotent and preserves a user-managed longmemory server', async () => {
    const config = {
        plugins: [plugin],
        mcp: { servers: { longmemory: { type: 'remote', url: 'https://team/mcp' } } },
    };
    const result = merge_opencode_config(config, plugin);
    assert.equal(result.added_plugin, false);
    assert.equal(result.added_mcp, false);
    assert.equal(result.config.plugins.length, 1);
    assert.equal(result.config.mcp.servers.longmemory.url, 'https://team/mcp');
});

test('merge rejects malformed shapes instead of corrupting them', async () => {
    assert.throws(() => merge_opencode_config(null, plugin), /object/);
    assert.throws(() => merge_opencode_config({ plugins: 'nope' }, plugin), /plugins/);
    assert.throws(() => merge_opencode_config({ mcp: { servers: [] } }, plugin), /servers/);
    assert.throws(
        () => merge_opencode_config({ mcp: { servers: { longmemory: 'broken' } } }, plugin),
        /longmemory/,
    );
    assert.throws(
        () => merge_opencode_config({ mcp: { servers: { longmemory: [] } } }, plugin),
        /longmemory/,
    );
});

test('merge validates every container before mutating the input', async () => {
    const config = { mcp: { servers: 'broken' } };
    assert.throws(() => merge_opencode_config(config, plugin), /servers/);
    assert.equal(config.plugins, undefined);
    assert.equal(config.mcp.servers, 'broken');
});

test('renderers quote the repository path and keep the key out of the unit', async () => {
    const wrapper = render_wrapper('/path with spaces/repo');
    assert.match(wrapper, /exec node '\/path with spaces\/repo\/dist\/cli\/index\.js' "\$@"/);

    const env = render_server_env({ api_key: 'secret-key', db_path: '/data/shared.db', port: 7331 });
    assert.match(env, /^LONGMEMORY_API_KEY=secret-key$/m);
    assert.match(env, /^LONGMEMORY_DB_PATH=\/data\/shared\.db$/m);

    const unit = render_systemd_unit({
        wrapper_path: '/home/u/.local/bin/longmemory',
        env_path: '/home/u/.config/longmemory/server.env',
    });
    assert.match(unit, /ExecStart=\/home\/u\/\.local\/bin\/longmemory serve --mcp-http/);
    assert.match(unit, /EnvironmentFile=\/home\/u\/\.config\/longmemory\/server\.env/);
    assert.doesNotMatch(unit, /secret-key/);

    const spaced = render_systemd_unit({
        wrapper_path: '/home/u/My Apps/longmemory',
        env_path: '/home/u/My Configs/longmemory/server.env',
    });
    assert.match(spaced, /ExecStart="\/home\/u\/My Apps\/longmemory" serve --mcp-http/);
    assert.match(spaced, /EnvironmentFile="\/home\/u\/My Configs\/longmemory\/server\.env"/);
});

test('the systemd renderer refuses paths it cannot represent', async () => {
    assert.throws(
        () => render_systemd_unit({
            wrapper_path: "/home/o'brien/.local/bin/longmemory",
            env_path: '/home/u/.config/longmemory/server.env',
        }),
        /systemd/,
    );
});

test('the default runner treats signals and spawn errors as failures', async () => {
    assert.equal(default_run('sh', ['-c', 'kill -TERM "$$"']).code, 1);
    const missing = default_run('longmemory-definitely-not-installed', []);
    assert.equal(missing.code, 1);
    assert.equal(missing.error, 'ENOENT');
});

test('install writes config, wrapper, key, unit, and stays idempotent', async () => {
    const home = make_home();
    const repo = make_repo();
    const env = make_env(home);
    const opencode_dir = join(home, '.config', 'opencode');
    const opencode_path = join(opencode_dir, 'opencode.json');
    const codex_config = join(home, '.codex', 'config.toml');
    mkdirSync(opencode_dir, { recursive: true });
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(opencode_path, JSON.stringify({
        plugins: ['existing'], mcp: { servers: { other: { type: 'local' } } },
    }), { mode: 0o600 });
    writeFileSync(codex_config, '[tui]\n');

    const state = {};
    const logs = [];
    const run = make_runner({ repo, home, state });
    const first = await install({ repo_root: repo, env, run, log: (line) => logs.push(line), dry_run: false });
    assert.equal(first.ok, true);

    const wrapper = join(home, '.local', 'bin', 'longmemory');
    assert.match(readFileSync(wrapper, 'utf8'), /lm repo with spaces/);
    const config = JSON.parse(readFileSync(opencode_path, 'utf8'));
    assert.ok(config.plugins.includes(join(repo, 'integrations', 'opencode-longmemory')));
    assert.ok(config.mcp.servers.longmemory);

    const env_path = join(home, '.config', 'longmemory', 'server.env');
    const envText = readFileSync(env_path, 'utf8');
    const key = envText.match(/^LONGMEMORY_API_KEY=(.+)$/m)[1];
    assert.match(envText, /^LONGMEMORY_API_KEY=[A-Za-z0-9_-]{43}$/m);
    assert.equal(statSync(wrapper).mode & 0o777, 0o755);
    assert.equal(statSync(env_path).mode & 0o777, 0o600);
    assert.equal(statSync(join(home, '.config', 'systemd', 'user', 'longmemory.service')).mode & 0o777, 0o644);
    assert.equal(statSync(opencode_path).mode & 0o777, 0o600);

    assert.equal(backups_of(opencode_path).length, 1);
    assert.match(readFileSync(join(opencode_dir, backups_of(opencode_path)[0]), 'utf8'), /"existing"/);
    assert.equal(backups_of(codex_config).length, 1);
    assert.equal(readFileSync(join(home, '.codex', backups_of(codex_config)[0]), 'utf8'), '[tui]\n');
    assert.match(readFileSync(codex_config, 'utf8'), /^\[plugins\."longmemory@longmemory"\]$/m);

    assert.ok(first.changed.some((item) => item.path === opencode_path && item.backup));
    assert.ok(logs.every((line) => !line.includes(key)));

    const second = await install({ repo_root: repo, env, run, log: () => {}, dry_run: false });
    assert.equal(second.ok, true);
    assert.equal(second.changed.length, 0);
    assert.equal(JSON.parse(readFileSync(opencode_path, 'utf8')).plugins.length, 2);
    assert.equal(readFileSync(env_path, 'utf8'), envText);
    assert.equal(state.plugin_calls, 1);
    assert.equal(state.marketplace_calls, 1);
    assert.equal(backups_of(opencode_path).length, 1);
    assert.equal(backups_of(codex_config).length, 1);

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

test('dry run writes nothing and makes no commands', async () => {
    const home = make_home();
    const repo = make_repo();
    const env = make_env(home);
    const run = () => {
        throw new Error('dry run must not invoke commands');
    };

    const result = await install({ repo_root: repo, env, run, log: () => {}, dry_run: true });
    assert.equal(result.ok, true);
    assert.deepEqual(result.changed, []);
    assert.equal(existsSync(join(home, '.config')), false);

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

test('a mid-install failure reports every written path and backup', async () => {
    const home = make_home();
    const repo = make_repo();
    const env = make_env(home);
    const opencode_dir = join(home, '.config', 'opencode');
    const opencode_path = join(opencode_dir, 'opencode.json');
    mkdirSync(opencode_dir, { recursive: true });
    writeFileSync(opencode_path, JSON.stringify({ plugins: [], mcp: { servers: {} } }));

    const run = make_runner({
        repo,
        home,
        intercept: (command, args) => {
            if (command === 'codex' && args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
                return { code: 1, stdout: '', stderr: 'marketplace exploded' };
            }
            return undefined;
        },
    });
    const logs = [];
    const result = await install({ repo_root: repo, env, run, log: (line) => logs.push(line), dry_run: false });

    assert.equal(result.ok, false);
    assert.ok(logs.some((line) => line.includes('install failed at codex: marketplace exploded')));
    assert.ok(logs.some((line) => line.includes(`changed: ${opencode_path}`) && line.includes('.bak.')));
    assert.ok(logs.some((line) => line.includes(join(home, '.local', 'bin', 'longmemory'))));
    assert.ok(existsSync(join(home, '.config', 'longmemory', 'server.env')));
    const failed_config = JSON.parse(readFileSync(opencode_path, 'utf8'));
    assert.equal(failed_config.plugins.length, 1);
    assert.equal(backups_of(opencode_path).length, 1);

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

test('a later Codex failure still backs up an earlier Codex change', async () => {
    const home = make_home();
    const repo = make_repo();
    const env = make_env(home);
    const codex_dir = join(home, '.codex');
    const codex_config = join(codex_dir, 'config.toml');
    mkdirSync(codex_dir, { recursive: true });
    writeFileSync(codex_config, '[tui]\n');

    const run = make_runner({
        repo,
        home,
        intercept: (command, args) => {
            if (command !== 'codex') return undefined;
            if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
                writeFileSync(codex_config, `${readFileSync(codex_config, 'utf8')}[marketplaces.longmemory]\nsource = "${repo}"\n`);
                return ok();
            }
            if (args[0] === 'plugin' && args[1] === 'add') {
                return { code: 1, stdout: '', stderr: 'plugin exploded' };
            }
            return undefined;
        },
    });
    const logs = [];
    const result = await install({ repo_root: repo, env, run, log: (line) => logs.push(line), dry_run: false });

    assert.equal(result.ok, false);
    assert.ok(logs.some((line) => line.includes('install failed at codex: plugin exploded')));
    assert.ok(logs.some((line) => line.includes(`changed: ${codex_config}`) && line.includes('.bak.')));
    assert.equal(backups_of(codex_config).length, 1);
    assert.equal(readFileSync(join(codex_dir, backups_of(codex_config)[0]), 'utf8'), '[tui]\n');
    assert.match(readFileSync(codex_config, 'utf8'), /\[marketplaces\.longmemory\]/);

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

test('a symlinked OpenCode config is updated through the link', async () => {
    const home = make_home();
    const repo = make_repo();
    const env = make_env(home);
    const dotfiles = join(home, 'dotfiles');
    const real_config = join(dotfiles, 'opencode.json');
    const opencode_dir = join(home, '.config', 'opencode');
    const link = join(opencode_dir, 'opencode.json');
    mkdirSync(dotfiles, { recursive: true });
    mkdirSync(opencode_dir, { recursive: true });
    writeFileSync(real_config, JSON.stringify({ plugins: [], mcp: { servers: {} } }), { mode: 0o600 });
    symlinkSync(real_config, link);

    const result = await install({ repo_root: repo, env, run: make_runner({ repo, home }), log: () => {}, dry_run: false });

    assert.equal(result.ok, true);
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    const written = JSON.parse(readFileSync(real_config, 'utf8'));
    assert.ok(written.plugins.includes(join(repo, 'integrations', 'opencode-longmemory')));
    assert.equal(statSync(real_config).mode & 0o777, 0o600);

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

test('both OpenCode config files produce a warning but still install', async () => {
    const home = make_home();
    const repo = make_repo();
    const env = make_env(home);
    const opencode_dir = join(home, '.config', 'opencode');
    mkdirSync(opencode_dir, { recursive: true });
    writeFileSync(join(opencode_dir, 'opencode.json'), JSON.stringify({ plugins: [], mcp: { servers: {} } }));
    writeFileSync(join(opencode_dir, 'opencode.jsonc'), '{}\n');
    const logs = [];

    const result = await install({ repo_root: repo, env, run: make_runner({ repo, home }), log: (line) => logs.push(line), dry_run: false });

    assert.equal(result.ok, true);
    assert.ok(logs.some((line) => line.includes('may take precedence')));

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

test('Codex verification fails when plugin add claims success without a marker', async () => {
    const home = make_home();
    const repo = make_repo();
    const env = make_env(home);
    const run = make_runner({
        repo,
        home,
        intercept: (command, args) => {
            if (command === 'codex' && args[0] === 'plugin' && args[1] === 'add') return ok('{}');
            return undefined;
        },
    });
    const logs = [];

    const result = await install({ repo_root: repo, env, run, log: (line) => logs.push(line), dry_run: false });

    assert.equal(result.ok, false);
    assert.ok(logs.some((line) => line.includes('codex config verification failed')));

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

test('a build failure stops before any writes', async () => {
    const home = make_home();
    const repo = make_repo();
    const env = make_env(home);
    const result = await install({
        repo_root: repo,
        env,
        run: () => ({ code: 1, stdout: '', stderr: 'build exploded' }),
        log: () => {},
        dry_run: false,
    });

    assert.equal(result.ok, false);
    assert.equal(result.changed.length, 0);
    assert.equal(existsSync(join(home, '.config')), false);

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

test('a missing codex CLI is a warning, a broken one stops the install', async () => {
    const home = make_home();
    const repo = make_repo();
    const env = make_env(home);
    const logs = [];

    const missing = make_runner({
        repo,
        home,
        intercept: (command, args) => command === 'codex' && args[0] === '--version'
            ? { code: 1, stdout: '', stderr: 'spawn codex ENOENT', error: 'ENOENT' }
            : undefined,
    });
    assert.equal((await install({ repo_root: repo, env, run: missing, log: (line) => logs.push(line), dry_run: false })).ok, true);
    assert.ok(logs.some((line) => line.includes('codex CLI not found')));

    const broken_home = make_home();
    const broken = make_runner({
        repo,
        home: broken_home,
        intercept: (command, args) => command === 'codex' && args[0] === '--version'
            ? { code: 1, stdout: '', stderr: 'permission denied' }
            : undefined,
    });
    const broken_logs = [];
    assert.equal((await install({
        repo_root: repo,
        env: make_env(broken_home),
        run: broken,
        log: (line) => broken_logs.push(line),
        dry_run: false,
    })).ok, false);
    assert.ok(broken_logs.some((line) => line.includes('permission denied')));

    rmSync(home, { recursive: true, force: true });
    rmSync(broken_home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

test('an existing opencode.jsonc is not shadowed by a new opencode.json', async () => {
    const home = make_home();
    const repo = make_repo();
    const env = make_env(home);
    const opencode_dir = join(home, '.config', 'opencode');
    mkdirSync(opencode_dir, { recursive: true });
    writeFileSync(join(opencode_dir, 'opencode.jsonc'), '{ // user config\n}\n');

    const result = await install({
        repo_root: repo,
        env,
        run: make_runner({ repo, home }),
        log: () => {},
        dry_run: false,
    });

    assert.equal(result.ok, false);
    assert.equal(existsSync(join(opencode_dir, 'opencode.json')), false);
    assert.equal(existsSync(join(home, '.local', 'bin', 'longmemory')), false);

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

test('a host without systemd --user skips the unit with a warning', async () => {
    const home = make_home();
    const repo = make_repo();
    const env = make_env(home);
    const logs = [];
    const run = make_runner({
        repo,
        home,
        intercept: (command, args) => command === 'systemctl' && args[0] === '--user'
            ? { code: 1, stdout: '', stderr: 'no user manager' }
            : undefined,
    });

    const result = await install({ repo_root: repo, env, run, log: (line) => logs.push(line), dry_run: false });
    assert.equal(result.ok, true);
    assert.equal(existsSync(join(home, '.config', 'systemd', 'user', 'longmemory.service')), false);
    assert.ok(logs.some((line) => line.includes('systemd --user unavailable')));

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

test('the wrapper and verification run through the real command runner', async () => {
    const home = make_home();
    const repo = make_repo();
    const env = make_env(home);
    const call_log = join(repo, 'calls.log');
    writeFileSync(join(repo, 'dist', 'cli', 'index.js'), `
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--help') { process.stdout.write('{"ok":true}'); process.exit(0); }
if (args[0] === 'init') {
    const index = args.indexOf('--db');
    if (index === -1) process.exit(3);
    fs.appendFileSync(process.env.SMOKE_LOG, \`init \${args[index + 1]}\\n\`);
    process.exit(0);
}
if (args[0] === 'project' && args[1] === 'context') { process.stdout.write('{"ok":true}'); process.exit(0); }
process.exit(4);
`);
    const wrapper = join(home, '.local', 'bin', 'longmemory');
    const run = make_runner({
        repo,
        home,
        intercept: (command, args, options) => {
            if (command === wrapper) return default_run(command, args, options);
            return undefined;
        },
    });

    const result = await install({
        repo_root: repo,
        env: { ...env, SMOKE_LOG: call_log },
        run,
        log: () => {},
        dry_run: false,
    });

    assert.equal(result.ok, true);
    assert.match(readFileSync(call_log, 'utf8'), /^init .*project\.db$/m);

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

test('mode resolution accepts the three shapes and rejects invalid combinations', async () => {
    assert.deepEqual(resolve_install_mode({}), { mode: 'local', hosts: [] });
    assert.deepEqual(resolve_install_mode({ hosts: ['cursor'] }), { mode: 'hosts', hosts: ['cursor'] });
    assert.deepEqual(resolve_install_mode({ all_hosts: true }), { mode: 'hosts', hosts: host_ids });
    assert.deepEqual(
        resolve_install_mode({ team: 'https://memory.test', token_file: '/tmp/token', hosts: ['claude'], space: 'team:core' }),
        { mode: 'team', hosts: ['claude'], server_url: 'https://memory.test', space: 'team:core' },
    );

    assert.throws(() => resolve_install_mode({ team: 'https://memory.test', hosts: ['claude'] }), /token-file/);
    assert.throws(() => resolve_install_mode({ team: 'https://memory.test', token_file: '/tmp/token' }), /hosts/);
    assert.throws(() => resolve_install_mode({ hosts: ['claude'], all_hosts: true }), /all-hosts/);
    assert.throws(() => resolve_install_mode({ token_file: '/tmp/token' }), /team/);
    assert.throws(() => resolve_install_mode({ space: 'personal' }), /team/);
    assert.throws(() => resolve_install_mode({ hosts: ['nope'] }), /nope/);
});

test('parse_hosts trims, dedupes, and validates ids', async () => {
    assert.deepEqual(parse_hosts('cursor, windsurf ,cursor'), ['cursor', 'windsurf']);
    assert.deepEqual(parse_hosts(''), []);
    assert.throws(() => parse_hosts('cursor,nope'), /nope/);
});

test('simple mcp merge adds only a missing longmemory entry', async () => {
    const config = { mcpServers: { other: { command: 'x' } } };
    const first = merge_simple_mcp_config(config, { command: 'longmemory', args: ['mcp'] });
    assert.equal(first.added, true);
    assert.deepEqual(config.mcpServers.longmemory, { command: 'longmemory', args: ['mcp'] });
    assert.deepEqual(config.mcpServers.other, { command: 'x' });

    const second = merge_simple_mcp_config(config, { command: 'ignored' });
    assert.equal(second.added, false);
    assert.deepEqual(config.mcpServers.longmemory, { command: 'longmemory', args: ['mcp'] });
});

test('simple mcp merge rejects malformed containers instead of corrupting them', async () => {
    assert.throws(() => merge_simple_mcp_config([], {}), /object/);
    assert.throws(() => merge_simple_mcp_config({ mcpServers: [] }, {}), /mcpServers/);
    assert.throws(() => merge_simple_mcp_config({ mcpServers: { longmemory: 'x' } }, {}), /longmemory/);
});

test('vscode merge uses the servers container and stdio type', async () => {
    const config = {};
    assert.equal(merge_vscode_mcp_config(config, { type: 'stdio', command: 'longmemory', args: ['mcp'] }).added, true);
    assert.deepEqual(config.servers.longmemory, { type: 'stdio', command: 'longmemory', args: ['mcp'] });
    assert.throws(() => merge_vscode_mcp_config({ mcpServers: {} }, {}), /servers/);
});

test('kilo jsonc merge preserves comments and is idempotent', async () => {
    const before = `{
  // keep this comment
  "$schema": "app.kilo.ai/config.json",
  "plugin": ["existing"],
  "mcp": {
    // other servers stay
    "other": { "type": "local", "command": ["x"], "enabled": true }
  }
}
`;
    const first = merge_kilo_jsonc(before, '/repo/integrations/kilo-longmemory/src/index.ts');
    assert.equal(first.changed, true);
    assert.equal(first.added_mcp, true);
    assert.equal(first.added_plugin, true);
    assert.match(first.text, /keep this comment/);
    assert.match(first.text, /other servers stay/);
    assert.match(first.text, /"existing"/);
    assert.match(first.text, /"longmemory"/);
    assert.match(first.text, /integrations\/kilo-longmemory\/src\/index\.ts/);

    const second = merge_kilo_jsonc(first.text, '/repo/integrations/kilo-longmemory/src/index.ts');
    assert.equal(second.changed, false);
    assert.equal(second.added_mcp, false);
    assert.equal(second.added_plugin, false);
});

test('kilo mcp entry matches the plugin config shape', async () => {
    assert.deepEqual(kilo_mcp_server(), {
        type: 'local',
        command: ['longmemory', 'mcp', '--project', 'current'],
        enabled: true,
    });
    assert.throws(() => merge_kilo_jsonc('[]', '/p'), /object/);
    assert.throws(() => merge_kilo_jsonc('{"mcp": []}', '/p'), /mcp/);
    assert.throws(() => merge_kilo_jsonc('{"plugin": {}}', '/p'), /plugin/);
    assert.throws(() => merge_kilo_jsonc('{not json', '/p'), /JSON/);
});

test('host mode writes only the selected host configs and no server artifacts', async () => {
    const home = make_home();
    const repo = make_repo();
    const logs = [];
    const result = await install({
        repo_root: repo,
        env: host_env(home),
        run: (command, args, options) => {
            if (command === 'code') return { code: 1, stdout: '', stderr: '', error: 'ENOENT' };
            return make_runner({ repo, home })(command, args, options);
        },
        log: (line) => logs.push(line),
        hosts: ['cursor', 'windsurf', 'copilot'],
    });

    assert.equal(result.ok, true);
    assert.equal(existsSync(join(home, '.cursor', 'mcp.json')), true);
    assert.equal(existsSync(join(home, '.config', 'devin', 'mcp_config.json')), true);
    assert.equal(existsSync(join(home, '.config', 'Code', 'User', 'mcp.json')), true);
    assert.equal(existsSync(join(home, '.config', 'longmemory', 'server.env')), false);
    assert.equal(existsSync(join(home, '.config', 'opencode', 'opencode.json')), false);
    assert.equal(existsSync(join(home, '.codex', 'config.toml')), false);
    assert.equal(existsSync(join(home, '.local', 'bin', 'longmemory')), true);

    const cursor = JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8'));
    assert.deepEqual(cursor.mcpServers.longmemory, { command: 'longmemory', args: ['mcp', '--project', 'current'] });
    const vscode = JSON.parse(readFileSync(join(home, '.config', 'Code', 'User', 'mcp.json'), 'utf8'));
    assert.equal(vscode.servers.longmemory.type, 'stdio');

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

test('host mode leaves an existing user server untouched', async () => {
    const home = make_home();
    const repo = make_repo();
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const path = join(home, '.cursor', 'mcp.json');
    writeFileSync(path, JSON.stringify({ mcpServers: { longmemory: { command: 'custom' } } }));

    const result = await install({ repo_root: repo, env: host_env(home), run: make_runner({ repo, home }), log: () => {}, hosts: ['cursor'] });

    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')).mcpServers.longmemory, { command: 'custom' });
    assert.equal(backups_of(path).length, 0);

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

test('team mode verifies the token, writes a 0600 client config, and skips server artifacts', async () => {
    const home = make_home();
    const repo = make_repo();
    const token_file = join(home, 'token');
    writeFileSync(token_file, 'lm_abcdefghijkl_secret\n');
    const requested = [];
    const fetch = async (url, init) => {
        requested.push({ url: String(url), init });
        return { ok: true, status: 200, json: async () => ({ data: { user_id: 'alice', spaces: [{ id: 'personal', writable: true }], write_space: { id: 'personal' } } }) };
    };
    const result = await install({
        repo_root: repo,
        env: host_env(home),
        run: make_runner({ repo, home }),
        log: () => {},
        team: 'https://memory.test/',
        token_file,
        space: 'personal',
        hosts: ['cursor'],
        fetch,
    });

    assert.equal(result.ok, true);
    assert.equal(requested[0].url, 'https://memory.test/v1/whoami');
    assert.equal(requested[0].init.headers.authorization, 'Bearer lm_abcdefghijkl_secret');
    const config_path = join(home, '.config', 'longmemory', 'client.json');
    assert.equal(statSync(config_path).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(config_path, 'utf8')), {
        server_url: 'https://memory.test',
        token: 'lm_abcdefghijkl_secret',
        space: 'personal',
        project_id: null,
    });
    assert.equal(existsSync(join(home, '.config', 'longmemory', 'server.env')), false);
    assert.equal(existsSync(join(home, '.config', 'opencode', 'opencode.json')), false);

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

test('team mode rejects a bad token and writes no client config', async () => {
    const home = make_home();
    const repo = make_repo();
    const token_file = join(home, 'token');
    writeFileSync(token_file, 'lm_bad');
    const logs = [];
    const result = await install({
        repo_root: repo,
        env: host_env(home),
        run: make_runner({ repo, home }),
        log: (line) => logs.push(line),
        team: 'https://memory.test',
        token_file,
        hosts: ['cursor'],
        fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    });

    assert.equal(result.ok, false);
    assert.equal(logs.some((line) => line.includes('authentication_failed')), true);
    assert.equal(existsSync(join(home, '.config', 'longmemory', 'client.json')), false);
    assert.equal(existsSync(join(home, '.cursor', 'mcp.json')), false);

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

test('invalid flag combinations fail before any write', async () => {
    const home = make_home();
    const repo = make_repo();
    const logs = [];
    const result = await install({
        repo_root: repo,
        env: host_env(home),
        run: make_runner({ repo, home }),
        log: (line) => logs.push(line),
        token_file: join(home, 'token'),
    });
    assert.equal(result.ok, false);
    assert.equal(logs.some((line) => line.includes('requires --team')), true);
    assert.equal(existsSync(join(home, '.local', 'bin', 'longmemory')), false);

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

test('dry run in host mode writes nothing and calls no host CLI', async () => {
    const home = make_home();
    const repo = make_repo();
    const calls = [];
    const logs = [];
    const result = await install({
        repo_root: repo,
        env: host_env(home),
        run: (command, args, options) => {
            calls.push([command, ...args]);
            return make_runner({ repo, home })(command, args, options);
        },
        log: (line) => logs.push(line),
        hosts: ['cursor', 'claude'],
        dry_run: true,
    });
    assert.equal(result.ok, true);
    assert.equal(existsSync(join(home, '.cursor', 'mcp.json')), false);
    assert.equal(calls.some((call) => call[0] === 'claude'), false);
    assert.ok(logs.some((line) => line.includes(join(home, '.cursor', 'mcp.json'))));

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

test('kilo host merges JSONC, preserves comments, and is idempotent', async () => {
    const home = make_home();
    const repo = make_repo();
    mkdirSync(join(repo, 'integrations', 'kilo-longmemory', 'src'), { recursive: true });
    writeFileSync(join(repo, 'integrations', 'kilo-longmemory', 'package.json'), '{}');
    writeFileSync(join(repo, 'integrations', 'kilo-longmemory', 'src', 'index.ts'), 'export default {};\n');
    mkdirSync(join(home, '.config', 'kilo'), { recursive: true });
    const kilo_path = join(home, '.config', 'kilo', 'kilo.jsonc');
    writeFileSync(kilo_path, '{\n  // keep\n  "mcp": {}\n}\n');

    await install({
        repo_root: repo,
        env: host_env(home),
        run: make_runner({ repo, home }),
        log: () => {},
        hosts: ['kilo'],
    });

    const text = readFileSync(kilo_path, 'utf8');
    assert.match(text, /keep/);
    assert.match(text, /"longmemory"/);
    assert.match(text, /file:\/\/.*integrations\/kilo-longmemory\/src\/index\.ts/);
    assert.equal(backups_of(kilo_path).length, 1);

    await install({
        repo_root: repo,
        env: host_env(home),
        run: make_runner({ repo, home }),
        log: () => {},
        hosts: ['kilo'],
    });
    assert.equal(readFileSync(kilo_path, 'utf8'), text);
    assert.equal(backups_of(kilo_path).length, 1);

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});
