// The shared-directory gate is effective access in the current session, enforced by both the agent
// preflight command and the local-analysis runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tmp } from '../support/temp.mjs';
import {
    ACCESS_ACTION, CAPABILITY, confineToSharedDirectory, probeSharedDirectory,
} from '../../plugin/analysis/src/io/shared-dir.mjs';

import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const CLI = path.join(ROOT, 'plugin', 'analysis', 'bin', 'foldseek-analyze.mjs');
const ACCESS_CLI = path.join(ROOT, 'plugin', 'analysis', 'bin', 'foldseek-check-access.mjs');

const execute = (entry, args) => {
    const done = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8' });
    return { status: done.status, stdout: done.stdout.trim(), stderr: done.stderr.trim() };
};
const checkAccess = sharedRoot => execute(ACCESS_CLI,
    sharedRoot === undefined ? [] : ['--shared-root', sharedRoot]);
const invoke = args => execute(CLI, args);

test('a real read grants this session access to the named directory', () => {
    const dir = tmp('shared-');
    const probe = probeSharedDirectory(dir);
    assert.equal(probe.granted, true);
    assert.equal(probe.capability, CAPABILITY.FULL);
    assert.equal(probe.sharedDir, fs.realpathSync(dir));
    assert.equal(probe.reason, null);
    assert.equal(probe.action, null);
});

test('a missing grant states the user action and fabricates no path', () => {
    for (const candidate of [null, '', path.join(tmp('shared-'), 'absent')]) {
        const probe = probeSharedDirectory(candidate);
        assert.equal(probe.granted, false, String(candidate));
        assert.equal(probe.capability, CAPABILITY.SUMMARY_ONLY);
        assert.equal(probe.sharedDir, null);
        assert.ok(probe.reason);
        assert.equal(probe.action, ACCESS_ACTION);
        assert.deepEqual(probe.unavailable,
            ['reading an exported artifact', 'every local analysis subcommand']);
    }
});

test('a readable file is not accepted as a shared directory', () => {
    const file = path.join(tmp('shared-'), 'not-a-directory');
    fs.writeFileSync(file, 'readable');
    const probe = probeSharedDirectory(file);
    assert.equal(probe.granted, false);
    assert.match(probe.reason, /not a directory/);
    assert.equal(probe.action, ACCESS_ACTION);
});

test('a filesystem root is too broad to stand in for the user-named shared directory', () => {
    const root = path.parse(path.resolve('.')).root;
    const probe = probeSharedDirectory(root);
    assert.equal(probe.granted, false);
    assert.match(probe.reason, /filesystem root/);
    assert.equal(probe.action, ACCESS_ACTION);
});

test('artifact roots are confined to the confirmed directory by real path', () => {
    const shared = tmp('shared-');
    const inside = path.join(shared, 'artifact');
    fs.mkdirSync(inside);
    assert.equal(confineToSharedDirectory(fs.realpathSync(shared), inside).granted, true);

    const outside = tmp('outside-');
    assert.equal(confineToSharedDirectory(fs.realpathSync(shared), outside).granted, false);

    const link = path.join(shared, 'linked-artifact');
    fs.symlinkSync(outside, link);
    const escaped = confineToSharedDirectory(fs.realpathSync(shared), link);
    assert.equal(escaped.granted, false);
    assert.match(escaped.reason, /outside/);
});

test('the access command performs the probe and gives an actionable refusal', () => {
    assert.ok(fs.existsSync(ACCESS_CLI), 'the check the skill names ships');
    const shared = tmp('shared-');
    const yes = checkAccess(shared);
    assert.equal(yes.status, 0, yes.stderr);
    assert.equal(JSON.parse(yes.stdout).access.granted, true);

    const noName = checkAccess();
    assert.equal(noName.status, 2);
    assert.match(JSON.parse(noName.stderr).access.action, /Ask the user/);

    const absent = checkAccess(path.join(shared, 'absent'));
    assert.equal(absent.status, 2);
    assert.equal(JSON.parse(absent.stderr).access.action, ACCESS_ACTION);
});

test('local analysis cannot bypass the current-session access gate', () => {
    const dir = tmp('artifact-');
    const out = tmp('run-');
    const missing = invoke(['hit', 'survey', '--artifact-root', dir, '--out', out]);
    assert.equal(missing.status, 2);
    assert.equal(JSON.parse(missing.stderr).usage.detail.flag, '--shared-root');

    const inaccessible = invoke(['hit', 'survey', '--shared-root', path.join(tmp('shared-'), 'absent'),
        '--artifact-root', dir, '--out', out]);
    assert.equal(inaccessible.status, 2);
    const report = JSON.parse(inaccessible.stderr).usage;
    assert.equal(report.problem, 'the shared directory is not accessible to this session');
    assert.equal(report.detail.action, ACCESS_ACTION);

    const outside = invoke(['hit', 'survey', '--shared-root', tmp('shared-'),
        '--artifact-root', dir, '--out', out]);
    assert.equal(outside.status, 2);
    assert.match(JSON.parse(outside.stderr).usage.detail.reason, /outside/);
    assert.equal(fs.existsSync(path.join(out, 'result.json')), false);
});

test('the second root and every ancestry root pass through the same boundary', () => {
    const shared = tmp('shared-');
    const fold = path.join(shared, 'fold');
    fs.mkdirSync(fold);
    const motif = tmp('outside-');
    const out = tmp('reach-');

    for (const extra of [
        ['--against', motif],
        ['--against', fold, '--via', motif],
    ]) {
        const done = invoke(['workflow', 'reach', '--shared-root', shared,
            '--artifact-root', fold, ...extra, '--out', out]);
        assert.equal(done.status, 2);
        assert.equal(JSON.parse(done.stderr).usage.problem,
            'an artifact root is not accessible through the confirmed shared directory');
    }
});

test('the runtime imports the gate that the standalone probe exercises', () => {
    const run = fs.readFileSync(path.join(HERE, '..', '..',
        'plugin', 'analysis', 'src', 'cli', 'run.mjs'), 'utf8');
    assert.match(run, /from '\.\.\/io\/shared-dir\.mjs'/);
    assert.match(run, /probeSharedDirectory\(declaredSharedRoot\)/);
    assert.match(run, /confineToSharedDirectory\(shared\.sharedDir, declared\)/);
});
