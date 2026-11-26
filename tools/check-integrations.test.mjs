import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    validate_agent_plugin_bundle,
    validate_antigravity_plugin,
    validate_claude_marketplace,
    validate_host_clis,
    validate_integrations,
    validate_kilo_package,
    validate_workspace_packs,
} from './check-integrations.mjs';

const repo = () => mkdtempSync(join(tmpdir(), 'longmemory-check-'));

test('the real repository passes every integration check', () => {
    assert.deepEqual(validate_integrations({ repo_root: fileURLToPath(new URL('..', import.meta.url)), host_clis: false }), []);
});

test('a missing manifest is reported instead of throwing', () => {
    const root = repo();
    try {
        const errors = validate_integrations({ repo_root: root, host_clis: false });
        assert.equal(errors.some((error) => error.includes('claude-code-longmemory/.claude-plugin/plugin.json')), true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

const make_bundle = (overrides = {}) => {
    const root = repo();
    const dir = join(root, 'integrations', 'longmemory-agent-plugin');
    mkdirSync(join(dir, 'skills', 'longmemory'), { recursive: true });
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
        $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
        name: 'longmemory',
        version: '0.2.0',
    }));
    writeFileSync(join(dir, 'mcp.json'), JSON.stringify({
        $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
        mcpServers: { longmemory: { type: 'stdio', command: 'longmemory', args: ['mcp', '--project', 'current'] } },
    }));
    return { root, dir, ...overrides };
};

test('a valid portable bundle passes and a credential-bearing one fails', () => {
    const bundle = make_bundle();
    try {
        assert.deepEqual(validate_agent_plugin_bundle({ repo_root: bundle.root }), []);
        writeFileSync(join(bundle.dir, 'mcp.json'), JSON.stringify({
            $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
            mcpServers: { longmemory: { type: 'streamable-http', url: 'http://127.0.0.1:7331/mcp', headers: { Authorization: 'Bearer ${LONGMEMORY_API_KEY}' } } },
        }));
        const errors = validate_agent_plugin_bundle({ repo_root: bundle.root });
        assert.equal(errors.some((error) => error.includes('must not contain headers') || error.includes('stdio')), true);
        assert.equal(errors.some((error) => error.includes('${')), true);
    } finally {
        rmSync(bundle.root, { recursive: true, force: true });
    }
});

test('a bundle with an unknown manifest field or mismatched name fails', () => {
    const bundle = make_bundle();
    try {
        writeFileSync(join(bundle.dir, 'plugin.json'), JSON.stringify({
            $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
            name: 'Long Memory',
            version: '0.2.0',
            extra: true,
        }));
        const errors = validate_agent_plugin_bundle({ repo_root: bundle.root });
        assert.equal(errors.some((error) => error.includes('name')), true);
        assert.equal(errors.some((error) => error.includes('extra')), true);
    } finally {
        rmSync(bundle.root, { recursive: true, force: true });
    }
});

const make_marketplace = () => {
    const root = repo();
    mkdirSync(join(root, '.claude-plugin'), { recursive: true });
    mkdirSync(join(root, 'integrations', 'claude-code-longmemory', '.claude-plugin'), { recursive: true });
    writeFileSync(join(root, 'integrations', 'claude-code-longmemory', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'longmemory', version: '0.2.0' }));
    writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({
        name: 'longmemory',
        owner: { name: 'CaviraOSS' },
        plugins: [{ name: 'longmemory', source: './integrations/claude-code-longmemory' }],
    }));
    return root;
};

test('a valid marketplace passes and a mismatched entry name fails', () => {
    const root = make_marketplace();
    try {
        assert.deepEqual(validate_claude_marketplace({ repo_root: root }), []);
        writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({
            name: 'longmemory',
            owner: { name: 'CaviraOSS' },
            plugins: [{ name: 'other', source: './integrations/claude-code-longmemory' }],
        }));
        assert.equal(validate_claude_marketplace({ repo_root: root }).some((error) => error.includes('does not match')), true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a marketplace source with .. or a missing directory fails', () => {
    const root = make_marketplace();
    try {
        writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({
            name: 'longmemory',
            owner: { name: 'CaviraOSS' },
            plugins: [{ name: 'longmemory', source: './../escape' }],
        }));
        const escaped = validate_claude_marketplace({ repo_root: root });
        assert.equal(escaped.some((error) => error.includes('..')), true);

        writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({
            name: 'longmemory',
            owner: { name: 'CaviraOSS' },
            plugins: [{ name: 'longmemory', source: './integrations/does-not-exist' }],
        }));
        const missing = validate_claude_marketplace({ repo_root: root });
        assert.equal(missing.some((error) => error.includes('does not resolve')), true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('every shipped mcp.json is checked for credentials and headers', () => {
    const root = repo();
    try {
        const dir = join(root, 'integrations', 'claude-code-longmemory');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
            mcpServers: {
                longmemory: {
                    type: 'stdio',
                    command: 'longmemory',
                    headers: { Authorization: 'Bearer ${LONGMEMORY_API_KEY}' },
                    env: { LONGMEMORY_TOKEN: 'lm_abcdefghijkl_0123456789abcdefghijklmnopqrstuvwxyzABC' },
                },
            },
        }));
        const errors = validate_integrations({ repo_root: root, host_clis: false })
            .filter((error) => error.includes('claude-code-longmemory/.mcp.json'));
        assert.equal(errors.some((error) => error.includes('headers')), true);
        assert.equal(errors.some((error) => error.includes('${')), true);
        assert.equal(errors.some((error) => error.includes('LongMemory token')), true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a bundle cwd or extension value outside the schema fails', () => {
    const bundle = make_bundle();
    try {
        const mcp = JSON.parse(readFileSync(join(bundle.dir, 'mcp.json'), 'utf8'));
        mcp.mcpServers.longmemory.cwd = '/tmp';
        writeFileSync(join(bundle.dir, 'mcp.json'), JSON.stringify(mcp));
        assert.equal(validate_agent_plugin_bundle({ repo_root: bundle.root }).some((error) => error.includes('cwd')), true);

        const plugin = JSON.parse(readFileSync(join(bundle.dir, 'plugin.json'), 'utf8'));
        plugin.extensions = { 'org.example': 'not-an-object' };
        writeFileSync(join(bundle.dir, 'plugin.json'), JSON.stringify(plugin));
        assert.equal(validate_agent_plugin_bundle({ repo_root: bundle.root }).some((error) => error.includes('extensions')), true);
    } finally {
        rmSync(bundle.root, { recursive: true, force: true });
    }
});

test('the CLI guards still run through a symlinked path', () => {
    const root = repo();
    const link = `${root}-link`;
    const tools = fileURLToPath(new URL('.', import.meta.url));
    try {
        mkdirSync(join(root, 'tools'), { recursive: true });
        for (const name of readdirSync(tools)) {
            if (name.endsWith('.mjs') && !name.endsWith('.test.mjs')) {
                copyFileSync(join(tools, name), join(root, 'tools', name));
            }
        }
        symlinkSync(join(fileURLToPath(new URL('..', import.meta.url)), 'node_modules'), join(root, 'node_modules'), 'dir');
        symlinkSync(root, link, 'dir');
        for (const args of [['check-integrations.mjs'], ['sync-integrations.mjs', '--check']]) {
            const result = spawnSync(process.execPath, [join(link, 'tools', args[0]), ...args.slice(1)], { encoding: 'utf8' });
            assert.equal(result.status, 1, `${args[0]} should fail on an empty repo but exited ${result.status}`);
            assert.match(result.stderr, /integration:(check failed|sync --check failed)/);
        }
    } finally {
        unlinkSync(link);
        unlinkSync(join(root, 'node_modules'));
        rmSync(root, { recursive: true, force: true });
    }
});

const antigravity = (overrides = {}) => {
    const root = repo();
    const dir = join(root, 'integrations', 'antigravity-longmemory');
    mkdirSync(join(dir, 'skills', 'longmemory'), { recursive: true });
    mkdirSync(join(dir, 'rules'), { recursive: true });
    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
        $schema: 'https://antigravity.google/schemas/v1/plugin.json',
        name: 'longmemory',
        displayName: 'LongMemory',
        version: '0.2.0',
        description: 'Durable personal and team memory for coding agents.',
        logo: 'assets/logo.svg',
        suggestedPrompts: ['Recall this project context'],
        author: { name: 'CaviraOSS', url: 'https://github.com/CaviraOSS' },
        ...overrides.manifest,
    }));
    writeFileSync(join(dir, 'mcp_config.json'), JSON.stringify(overrides.mcp ?? {
        mcpServers: { longmemory: { command: 'longmemory', args: ['mcp', '--project', 'current'] } },
    }));
    writeFileSync(join(dir, 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128"/></svg>');
    writeFileSync(join(dir, 'rules', 'AGENTS.md'), '# LongMemory\n\nUse LongMemory tools before substantial work.\n');
    writeFileSync(join(dir, 'README.md'), '# LongMemory for Antigravity\n');
    writeFileSync(join(dir, 'skills', 'longmemory', 'SKILL.md'), '---\nname: longmemory\ndescription: test\n---\n\nBody.\n');
    return { root, dir };
};

test('a complete Antigravity plugin passes and a remote MCP config fails', () => {
    const fixture = antigravity();
    try {
        assert.deepEqual(validate_antigravity_plugin({ repo_root: fixture.root }), []);
        writeFileSync(join(fixture.dir, 'mcp_config.json'), JSON.stringify({
            mcpServers: {
                longmemory: {
                    serverUrl: 'http://127.0.0.1:7331/mcp',
                    headers: { Authorization: 'Bearer ${LONGMEMORY_API_KEY}' },
                    variables: [{ name: 'LONGMEMORY_API_KEY' }],
                },
            },
        }));
        const errors = validate_antigravity_plugin({ repo_root: fixture.root });
        assert.equal(errors.some((error) => error.includes('stdio')), true);
        assert.equal(errors.some((error) => error.includes('variables')), true);
        assert.equal(errors.some((error) => error.includes('${')), true);
    } finally {
        rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('an Antigravity plugin with a bad name, too many prompts, or a missing logo fails', () => {
    const fixture = antigravity({
        manifest: {
            name: 'Long Memory',
            suggestedPrompts: ['one', 'two', 'three', 'four'],
            logo: '../escape.svg',
        },
    });
    try {
        const errors = validate_antigravity_plugin({ repo_root: fixture.root });
        assert.equal(errors.some((error) => error.includes('"name"')), true);
        assert.equal(errors.some((error) => error.includes('suggestedPrompts')), true);
        assert.equal(errors.some((error) => error.includes('logo')), true);
    } finally {
        rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('a missing Antigravity plugin file is reported instead of throwing', () => {
    const root = repo();
    try {
        const errors = validate_antigravity_plugin({ repo_root: root });
        assert.equal(errors.some((error) => error.includes('antigravity-longmemory/plugin.json')), true);
        assert.equal(errors.some((error) => error.includes('mcp_config.json')), true);
        assert.equal(errors.some((error) => error.includes('rules/AGENTS.md')), true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

const kilo = (overrides = {}) => {
    const root = repo();
    const dir = join(root, 'integrations', 'kilo-longmemory');
    mkdirSync(join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, 'skills', 'longmemory'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: '@caviraoss/kilo-longmemory',
        version: '0.1.0',
        type: 'module',
        exports: { './server': './src/index.ts' },
        files: ['src', 'skills', 'kilo.json', 'README.md', 'LICENSE'],
        engines: { opencode: '^7.8.0' },
        peerDependencies: { '@kilocode/plugin': '^7.8.0' },
        ...overrides.manifest,
    }));
    writeFileSync(join(dir, 'src', 'index.ts'), "export default { id: 'longmemory', server };\n");
    writeFileSync(join(dir, 'src', 'context.ts'), 'export {};\n');
    writeFileSync(join(dir, 'src', 'config.ts'), 'export {};\n');
    writeFileSync(join(dir, 'kilo.json'), JSON.stringify(overrides.config ?? {
        $schema: 'app.kilo.ai/config.json',
        mcp: { longmemory: { type: 'local', command: ['longmemory', 'mcp', '--project', 'current'], enabled: true } },
    }));
    writeFileSync(join(dir, 'README.md'), '# LongMemory for Kilo Code\n');
    writeFileSync(join(dir, 'LICENSE'), 'Apache-2.0\n');
    writeFileSync(join(dir, 'skills', 'longmemory', 'SKILL.md'), '---\nname: longmemory\ndescription: test\n---\n\nBody.\n');
    return { root, dir };
};

test('a valid Kilo package passes and an mcp.servers template fails', () => {
    const fixture = kilo();
    try {
        assert.deepEqual(validate_kilo_package({ repo_root: fixture.root }), []);
        writeFileSync(join(fixture.dir, 'kilo.json'), JSON.stringify({
            mcp: { servers: { longmemory: { type: 'local', command: ['longmemory'] } } },
        }));
        const errors = validate_kilo_package({ repo_root: fixture.root });
        assert.equal(errors.some((error) => error.includes('mcp.longmemory')), true);
    } finally {
        rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('a Kilo package without exports["./server"] or with a wrong name fails', () => {
    const fixture = kilo({ manifest: { name: '@other/kilo', exports: { '.': './src/index.ts' } } });
    try {
        const errors = validate_kilo_package({ repo_root: fixture.root });
        assert.equal(errors.some((error) => error.includes('@caviraoss/kilo-longmemory')), true);
        assert.equal(errors.some((error) => error.includes('./server')), true);
    } finally {
        rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('host CLI validation skips an absent CLI and reports a failing one', () => {
    assert.deepEqual(validate_host_clis({ repo_root: '/tmp', which: () => null, run: () => { throw new Error('must not run'); } }), []);
    const calls = [];
    const run = (command, args) => { calls.push([command, ...args]); return { status: 0, stdout: '', stderr: '' }; };
    assert.deepEqual(validate_host_clis({ repo_root: '/repo', which: () => '/usr/bin/agy', run }), []);
    assert.equal(calls[0][0], '/usr/bin/agy');
    assert.deepEqual(calls[0].slice(1, 3), ['plugin', 'validate']);
    assert.equal(calls[0].includes('--strict'), true);

    const failing = validate_host_clis({ repo_root: '/repo', which: () => '/usr/bin/agy', run: () => ({ status: 1, stdout: 'bad manifest', stderr: '' }) });
    assert.equal(failing.length, 1);
    assert.equal(failing[0].includes('bad manifest'), true);
});

test('workspace packs validate as secret-free stdio and reject the wrong container', () => {
    const fixture = (() => {
        const root = repo();
        const copilot = join(root, 'integrations', 'copilot-longmemory');
        const windsurf = join(root, 'integrations', 'windsurf-longmemory');
        mkdirSync(join(copilot, '.vscode'), { recursive: true });
        mkdirSync(join(copilot, '.github', 'instructions'), { recursive: true });
        mkdirSync(join(windsurf, '.windsurf', 'rules'), { recursive: true });
        writeFileSync(join(copilot, '.vscode', 'mcp.json'), JSON.stringify({
            servers: { longmemory: { type: 'stdio', command: 'longmemory', args: ['mcp', '--project', 'current'] } },
        }));
        writeFileSync(join(copilot, '.github', 'instructions', 'longmemory.instructions.md'), '---\napplyTo: "**"\n---\n\nUse LongMemory.\n');
        writeFileSync(join(copilot, 'README.md'), '# Copilot\n');
        writeFileSync(join(windsurf, '.windsurf', 'rules', 'longmemory.md'), '---\ntrigger: always_on\n---\n\nUse LongMemory.\n');
        writeFileSync(join(windsurf, 'mcp_config.json'), JSON.stringify({
            mcpServers: { longmemory: { command: 'longmemory', args: ['mcp', '--project', 'current'] } },
        }));
        writeFileSync(join(windsurf, 'README.md'), '# Windsurf\n');
        mkdirSync(join(root, 'integrations', 'mcp-configs'), { recursive: true });
        writeFileSync(join(root, 'integrations', 'mcp-configs', 'README.md'), '# MCP configs\n');
        for (const name of ['cursor', 'windsurf']) {
            writeFileSync(join(root, 'integrations', 'mcp-configs', `${name}.json`), JSON.stringify({
                mcpServers: { longmemory: { command: 'longmemory', args: ['mcp', '--project', 'current'] } },
            }));
        }
        writeFileSync(join(root, 'integrations', 'mcp-configs', 'vscode.json'), JSON.stringify({
            servers: { longmemory: { type: 'stdio', command: 'longmemory', args: ['mcp', '--project', 'current'] } },
        }));
        return root;
    })();
    try {
        assert.deepEqual(validate_workspace_packs({ repo_root: fixture }), []);
        writeFileSync(join(fixture, 'integrations', 'copilot-longmemory', '.vscode', 'mcp.json'), JSON.stringify({
            mcpServers: { longmemory: { command: 'longmemory' } },
        }));
        const errors = validate_workspace_packs({ repo_root: fixture });
        assert.equal(errors.some((error) => error.includes('.vscode/mcp.json') && error.includes('servers')), true);
    } finally {
        rmSync(fixture, { recursive: true, force: true });
    }
});
