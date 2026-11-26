import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { check_skill_copies } from './check-integrations.mjs';
import { skill_targets, sync_integrations } from './sync-integrations.mjs';

const make_repo = () => {
    const repo = mkdtempSync(join(tmpdir(), 'longmemory-skills-'));
    mkdirSync(join(repo, 'integrations', '_shared', 'longmemory'), { recursive: true });
    writeFileSync(join(repo, 'integrations', '_shared', 'longmemory', 'SKILL.md'), '---\nname: longmemory\ndescription: test\n---\n\nBody.\n');
    for (const target of skill_targets) {
        mkdirSync(dirname(join(repo, target)), { recursive: true });
        writeFileSync(join(repo, target), 'stale\n');
    }
    return repo;
};

test('sync copies the shared skill to every target and is idempotent', () => {
    const repo = make_repo();
    try {
        const first = sync_integrations({ repo_root: repo, log: () => {} });
        assert.deepEqual(first.changed, skill_targets);
        for (const target of skill_targets) {
            assert.equal(readFileSync(join(repo, target), 'utf8'), readFileSync(join(repo, 'integrations', '_shared', 'longmemory', 'SKILL.md'), 'utf8'));
        }
        const second = sync_integrations({ repo_root: repo, log: () => {} });
        assert.deepEqual(second.changed, []);
        assert.deepEqual(second.unchanged, skill_targets);
        assert.deepEqual(check_skill_copies({ repo_root: repo }), []);
    } finally {
        rmSync(repo, { recursive: true, force: true });
    }
});

test('sync --dry-run does not write', () => {
    const repo = make_repo();
    try {
        const result = sync_integrations({ repo_root: repo, dry_run: true, log: () => {} });
        assert.deepEqual(result.changed, skill_targets);
        for (const target of skill_targets) assert.equal(readFileSync(join(repo, target), 'utf8'), 'stale\n');
    } finally {
        rmSync(repo, { recursive: true, force: true });
    }
});

test('check reports a drifted copy and a missing copy', () => {
    const repo = make_repo();
    try {
        sync_integrations({ repo_root: repo, log: () => {} });
        writeFileSync(join(repo, skill_targets[0]), 'drifted\n');
        rmSync(join(repo, skill_targets[1]));
        const errors = check_skill_copies({ repo_root: repo });
        assert.equal(errors.some((error) => error.includes(skill_targets[0]) && error.includes('drifted')), true);
        assert.equal(errors.some((error) => error.includes(skill_targets[1]) && error.includes('missing')), true);
    } finally {
        rmSync(repo, { recursive: true, force: true });
    }
});

test('check rejects host env metadata and missing frontmatter fields', () => {
    const repo = make_repo();
    try {
        const source = join(repo, 'integrations', '_shared', 'longmemory', 'SKILL.md');
        writeFileSync(source, '---\nname: longmemory\ndescription: test\nmetadata:\n  openclaw: {}\n---\n\nBody.\n');
        sync_integrations({ repo_root: repo, log: () => {} });
        assert.equal(check_skill_copies({ repo_root: repo }).some((error) => error.includes('metadata')), true);

        writeFileSync(source, '---\nname: longmemory\n---\n\nBody.\n');
        sync_integrations({ repo_root: repo, log: () => {} });
        assert.equal(check_skill_copies({ repo_root: repo }).some((error) => error.includes('description')), true);
    } finally {
        rmSync(repo, { recursive: true, force: true });
    }
});

test('editing the shared source reports every stale copy', () => {
    const repo = make_repo();
    try {
        sync_integrations({ repo_root: repo, log: () => {} });
        const source = join(repo, 'integrations', '_shared', 'longmemory', 'SKILL.md');
        writeFileSync(source, readFileSync(source, 'utf8') + '\nshared edit\n');
        const errors = check_skill_copies({ repo_root: repo });
        for (const target of skill_targets) {
            assert.equal(errors.some((error) => error.includes(target) && error.includes('drifted')), true);
        }
    } finally {
        rmSync(repo, { recursive: true, force: true });
    }
});
