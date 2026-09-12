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
 *  file  : tools/check-release-files.mjs
 *  usage : validates LongMemory release and SDK package files
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const legacy_js = ['open', 'memory-js'].join('');
const legacy_py = ['open', 'memory-py'].join('');
const required = [
    'LICENSE',
    'README.md',
    'Dockerfile',
    'docker-compose.yml',
    'package.json',
    'packages/longmemory-py/pyproject.toml',
    'packages/longmemory-py/src/longmemory/client.py',
    `packages/${legacy_py}/pyproject.toml`,
    `packages/${legacy_js}/package.json`,
    '.github/workflows/publish-sdks.yml',
];
const failures = required.filter((path) => !existsSync(resolve(root, path))).map((path) => `${path}: missing`);
for (const path of ['docker-compose.yml', '.github/workflows/publish-sdks.yml']) {
    try {
        parse(read(path));
    } catch (error) {
        failures.push(`${path}: invalid YAML (${error.message})`);
    }
}
const root_package = JSON.parse(read('package.json'));
const bridge = JSON.parse(read(`packages/${legacy_js}/package.json`));
if (root_package.name !== 'longmemory' || root_package.version !== '1.0.0')
    failures.push('npm package must be longmemory@1.0.0');
if (bridge.name !== legacy_js || bridge.dependencies?.longmemory !== '^1.0.0')
    failures.push('legacy npm bridge is invalid');
if (!read('packages/longmemory-py/pyproject.toml').includes('name = "longmemory-sdk"'))
    failures.push('Python SDK distribution must be longmemory-sdk');
if (!read(`packages/${legacy_py}/pyproject.toml`).includes('longmemory-sdk>=1.0.0,<2'))
    failures.push('legacy Python bridge dependency is invalid');
if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log(`validated ${required.length} release and SDK files`);
