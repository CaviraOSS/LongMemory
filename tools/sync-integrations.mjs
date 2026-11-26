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
*  file  : tools/sync-integrations.mjs
*  usage : copies the shared LongMemory skill into every host package
*/

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check_skill_copies } from './check-integrations.mjs';
import { is_direct_execution } from './script-entry.mjs';
import { shared_skill, skill_targets } from './skill-paths.mjs';

export { skill_targets };

// A target lives at integrations/<package>/skills/longmemory/SKILL.md; the package
// directory must already exist so a missing package is reported, not invented.
const package_directory = (target) => target.split('/').slice(0, 2).join('/');

export function sync_integrations({ repo_root, dry_run = false, log = console.log }) {
    const source_file = join(repo_root, shared_skill);
    if (!existsSync(source_file)) throw new Error(`shared skill source is missing: ${shared_skill}`);
    const source = readFileSync(source_file);
    const changed = [];
    const unchanged = [];
    const missing = [];

    for (const target of skill_targets) {
        const package_dir = join(repo_root, package_directory(target));
        if (!existsSync(package_dir)) {
            missing.push(target);
            log(`missing ${target}`);
            continue;
        }
        const target_file = join(repo_root, target);
        if (existsSync(target_file) && readFileSync(target_file).equals(source)) {
            unchanged.push(target);
            log(`unchanged ${target}`);
            continue;
        }
        changed.push(target);
        if (dry_run) {
            log(`would sync ${target}`);
            continue;
        }
        mkdirSync(dirname(target_file), { recursive: true });
        writeFileSync(target_file, source);
        log(`synced ${target}`);
    }

    return { changed, unchanged, missing };
}

const main = () => {
    const repo_root = fileURLToPath(new URL('..', import.meta.url));
    const args = process.argv.slice(2);
    const unknown = args.filter((arg) => !['--dry-run', '--check'].includes(arg));
    if (unknown.length) {
        console.error(`integration:sync: unknown flag ${unknown[0]}`);
        process.exit(1);
    }

    if (args.includes('--check')) {
        const errors = check_skill_copies({ repo_root });
        if (errors.length) {
            console.error('integration:sync --check failed:');
            for (const error of errors) console.error(`  - ${error}`);
            process.exit(1);
        }
        console.log(`integration:sync: ${skill_targets.length} skill copy(ies) match.`);
        return;
    }

    const dry_run = args.includes('--dry-run');
    const result = sync_integrations({ repo_root, dry_run, log: (line) => console.log(`  ${line}`) });
    console.log(
        `integration:sync: ${result.changed.length} ${dry_run ? 'to sync' : 'synced'}, `
        + `${result.unchanged.length} unchanged, ${result.missing.length} missing.`,
    );
};

if (is_direct_execution(import.meta.url)) main();
