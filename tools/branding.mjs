/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/
 *
 *  cavira oss (c) 2026  -  nullure (c) 2026
 *  ----------------------------------------------------------
 *  file  : tools/branding.mjs
 *  usage : applies and verifies LongMemory branding and source headers
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const marker = 'cavira oss (c) 2026  -  nullure (c) 2026';
const legacy = new RegExp(['open', '[_-]?', 'memory'].join(''), 'i');
const ignored_dirs = new Set([
    '.git',
    '.longmemory',
    '.next',
    '__pycache__',
    'data',
    'dist',
    'node_modules',
    'runs',
    'tmp',
]);
const legacy_bridges = [`packages/${['open', 'memory-js'].join('')}/`, `packages/${['open', 'memory-py'].join('')}/`];
const legacy_docs = new Set([
    'README.md',
    'CHANGELOG.md',
    'MIGRATION.md',
    'docs/python-sdk.md',
    '.github/workflows/publish-sdks.yml',
]);
const no_header = new Set([
    'header.txt',
    'dashboard/next-env.d.ts',
    'integrations/n8n-nodes-longmemory/eslint.config.mjs',
]);
const binary = new Set([
    '.db',
    '.gif',
    '.gz',
    '.ico',
    '.jpeg',
    '.jpg',
    '.pdf',
    '.png',
    '.tsbuildinfo',
    '.vsix',
    '.woff',
    '.woff2',
    '.zip',
]);
const template = `/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ \\/ __ \\/ __ \`/ /|_/ / _ \\/ __ \`__ \\/ __ \\/ ___/ / / /
*   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\\____/_/ /_/\\__, /_/  /_/\\___/_/ /_/ /_/\\____/_/   \\__, /
                     /____/                                 /____/
 *
 *  cavira oss (c) 2026  -  nullure (c) 2026
 *  ----------------------------------------------------------
 *  file  : {{file}}
 *  usage : {{usage}}
 */
`;

const paths = () => {
    const result = [];
    const walk = (directory, parent = '') => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = parent ? `${parent}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (!ignored_dirs.has(entry.name) && !entry.name.endsWith('.egg-info'))
                    walk(resolve(directory, entry.name), path);
            } else if (entry.isFile()) result.push(path);
        }
    };
    walk(root);
    return result.sort();
};
const is_bridge = (path) => legacy_bridges.some((prefix) => path.startsWith(prefix));
const is_text = (value) => !value.subarray(0, Math.min(value.length, 8192)).includes(0);
const style = (path) => {
    if (no_header.has(path) || basename(path) === 'LICENSE' || binary.has(extname(path).toLowerCase())) return null;
    const extension = extname(path).toLowerCase();
    if (extension === '.json' && (basename(path) === 'tsconfig.json' || path.includes('/.vscode/'))) return 'block';
    if (extension === '.json') return null;
    if (['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.scss', '.txt'].includes(extension)) return 'block';
    if (['.md', '.html', '.svg', '.xml'].includes(extension)) return 'html';
    if (['.py', '.yaml', '.yml', '.toml', '.sh', '.ps1', '.env', '.example'].includes(extension)) return 'hash';
    if (extension === '.sql') return 'dash';
    if (['Dockerfile', 'Makefile'].includes(basename(path)) || basename(path).startsWith('.')) return 'hash';
    return null;
};
const usage = (path) =>
    path.startsWith('packages/longmemory-py/')
        ? 'supports the LongMemory Python HTTP SDK'
        : `supports LongMemory ${basename(path, extname(path)).replace(/[-_]/g, ' ').toLowerCase()}`;
const render = (path, kind, eol) => {
    const value = template.replace('{{file}}', path).replace('{{usage}}', usage(path)).trimEnd();
    if (kind === 'block') return value.replace(/\n/g, eol);
    const lines = value
        .replace(/^\/\*\s*\n/, '')
        .replace(/\n\s*\*\/$/, '')
        .split('\n')
        .map((line) => line.replace(/^\s*\*\s?/, ''));
    if (kind === 'html') return ['<!--', ...lines, '-->'].join(eol);
    const prefix = kind === 'dash' ? '--' : '#';
    return lines.map((line) => (line ? `${prefix} ${line}` : prefix)).join(eol);
};
const offset = (content, path) => {
    const shebang = content.match(/^#![^\r\n]*(?:\r?\n|$)/)?.[0];
    if (shebang) return shebang.length;
    if (basename(path) === 'Dockerfile') return content.match(/^#\s*syntax=[^\r\n]*(?:\r?\n|$)/)?.[0].length ?? 0;
    return 0;
};
const add_header = (content, path) => {
    const kind = style(path);
    if (!kind || content.includes(marker)) return content;
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const start = offset(content, path);
    return `${content.slice(0, start)}${render(path, kind, eol)}${eol}${eol}${content.slice(start)}`;
};

if (process.argv.includes('--apply')) {
    if (!existsSync(resolve(root, 'header.txt'))) writeFileSync(resolve(root, 'header.txt'), template);
    let changed = 0;
    for (const path of paths()) {
        const target = resolve(root, path);
        const bytes = readFileSync(target);
        if (!is_text(bytes)) continue;
        const content = bytes.toString('utf8');
        const next = add_header(content.replace(/\u001b\[0m/g, ''), path);
        if (next !== content) {
            writeFileSync(target, next);
            changed++;
        }
    }
    console.log(JSON.stringify({ changed }));
}

const failures = [];
for (const path of paths()) {
    if (is_bridge(path)) continue;
    if (legacy.test(path)) failures.push(`${path}: legacy brand in path`);
    const bytes = readFileSync(resolve(root, path));
    if (!is_text(bytes)) continue;
    const content = bytes.toString('utf8');
    if (!legacy_docs.has(path) && legacy.test(content)) failures.push(`${path}: legacy brand in content`);
    if (style(path) && !content.includes(marker)) failures.push(`${path}: missing header`);
}
if (!existsSync(resolve(root, 'header.txt'))) failures.push('header.txt: missing');
if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('LongMemory branding and headers valid');
