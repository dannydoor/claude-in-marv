import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SOURCE = path.join(ROOT, 'plugin', 'scripts', 'start-marv-api.mjs');

function stagedLauncher(layout = 'scripts') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foldseek-mcp-launcher-'));
    const launcher = path.join(root, 'scripts', 'start-marv-api.mjs');
    const entry = path.join(root, 'vendor', 'marv-api', layout, 'marv-mcp.js');
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.copyFileSync(SOURCE, launcher);
    fs.writeFileSync(entry, [
        "process.stdout.write(JSON.stringify({",
        "  baseUrl: process.env.MARV_BASE_URL,",
        "  sharedDir: process.env.MARV_SHARED_DIR,",
        "}));",
        '',
    ].join('\n'));
    return { root, launcher };
}

function run(launcher, env) {
    const result = spawnSync(process.execPath, [launcher], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}

test('the launcher supplies portable defaults when plugin settings are empty', () => {
    const { root, launcher } = stagedLauncher();
    const home = path.join(root, 'home');
    fs.mkdirSync(home);
    const actual = run(launcher, {
        ...process.env,
        HOME: home,
        MARV_BASE_URL: '',
        MARV_SHARED_DIR: '',
    });
    assert.deepEqual(actual, {
        baseUrl: 'https://search.foldseek.com',
        sharedDir: path.join(home, 'marv-shared'),
    });
});

test('the launcher preserves configured values with the legacy runtime layout', () => {
    const { root, launcher } = stagedLauncher('bin');
    const sharedDir = path.join(root, 'chosen');
    const actual = run(launcher, {
        ...process.env,
        MARV_BASE_URL: 'https://foldseek.example.test',
        MARV_SHARED_DIR: sharedDir,
    });
    assert.deepEqual(actual, {
        baseUrl: 'https://foldseek.example.test',
        sharedDir,
    });
});
