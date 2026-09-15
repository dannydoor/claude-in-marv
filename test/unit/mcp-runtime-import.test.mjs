import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const IMPORT = path.join(ROOT, 'tools', 'import-mcp-runtime.mjs');
const CHECK = path.join(ROOT, 'tools', 'check-mcp-runtime.mjs');
const COMMIT = 'a'.repeat(40);
const PLUGIN_VERSION = '7.8.9';
const MCP_VERSION = '4.5.6';
const MCP_TAG = `mcp-v${MCP_VERSION}`;
const WRONG_MCP_TAG = `mcp-v${MCP_VERSION.replace(/\d+$/, value => Number(value) + 1)}`;
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function makePlugin(parent) {
    const plugin = path.join(parent, 'plugin');
    fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), `${JSON.stringify({
        name: 'claude-in-marv', version: PLUGIN_VERSION, description: 'test plugin',
    }, null, 2)}\n`);
    return plugin;
}

function makeArtifact(parent, version = MCP_VERSION) {
    const runtime = path.join(parent, 'runtime');
    fs.mkdirSync(path.join(runtime, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(runtime, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(runtime, 'LICENSE'), 'GPL-3.0-or-later\n');
    fs.writeFileSync(path.join(runtime, 'THIRD_PARTY_NOTICES.md'), '# Third-party notices\n');
    fs.writeFileSync(path.join(runtime, 'scripts', 'marv-mcp.js'), '#!/usr/bin/env node\n');
    fs.chmodSync(path.join(runtime, 'scripts', 'marv-mcp.js'), 0o755);
    fs.writeFileSync(path.join(runtime, 'dist', 'server.mjs'), "import fs from 'node:fs';\nexport { fs };\n");
    fs.writeFileSync(path.join(runtime, 'package.json'), `${JSON.stringify({
        name: 'marv-mcp', version, private: true, type: 'module',
    }, null, 2)}\n`);
    const artifact = path.join(parent, `marv-api-runtime-v${version}.zip`);
    const zip = spawnSync('zip', ['-X', '-q', artifact,
        'LICENSE', 'THIRD_PARTY_NOTICES.md', 'scripts/marv-mcp.js', 'dist/server.mjs', 'package.json'],
    { cwd: runtime, encoding: 'utf8' });
    assert.equal(zip.status, 0, zip.stderr);
    return artifact;
}

function importRuntime(plugin, artifact, options = {}) {
    const args = [IMPORT,
        '--artifact', artifact,
        '--sha256', options.sha ?? digest(artifact),
        '--source-kind', options.sourceKind ?? 'local-build',
        '--upstream-commit', COMMIT,
        '--plugin-dir', plugin,
    ];
    if (options.tag) args.push('--upstream-tag', options.tag);
    return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

test('a verified local build produces one complete plugin MCP update', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'foldseek-mcp-import-test-'));
    const plugin = makePlugin(temp);
    const artifact = makeArtifact(temp);
    const result = importRuntime(plugin, artifact);
    assert.equal(result.status, 0, result.stderr);

    const manifest = JSON.parse(fs.readFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.deepEqual(Object.keys(manifest.userConfig), ['base_url', 'shared_dir']);
    const provenance = JSON.parse(fs.readFileSync(path.join(plugin, 'mcp-version.json'), 'utf8'));
    assert.equal(provenance.source.kind, 'local-build');
    assert.equal(provenance.upstream.tag, null);
    assert.equal(provenance.upstream.commit, COMMIT);
    assert.equal(provenance.artifact.sha256, digest(artifact));
    assert.equal(Object.keys(provenance.files).length, 5);

    const check = spawnSync(process.execPath,
        [CHECK, '--plugin-dir', plugin, '--required'], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
});

test('a wrong artifact digest changes no plugin file', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'foldseek-mcp-import-test-'));
    const plugin = makePlugin(temp);
    const before = fs.readFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'));
    const result = importRuntime(plugin, makeArtifact(temp), { sha: '0'.repeat(64) });
    assert.notEqual(result.status, 0);
    assert.deepEqual(fs.readFileSync(path.join(plugin, '.claude-plugin', 'plugin.json')), before);
    assert.equal(fs.existsSync(path.join(plugin, '.mcp.json')), false);
    assert.equal(fs.existsSync(path.join(plugin, 'vendor')), false);
});

test('a versioned release artifact records and validates its tag', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'foldseek-mcp-import-test-'));
    const plugin = makePlugin(temp);
    const artifact = makeArtifact(temp);
    const result = importRuntime(plugin, artifact, { sourceKind: 'release', tag: MCP_TAG });
    assert.equal(result.status, 0, result.stderr);
    const provenance = JSON.parse(fs.readFileSync(path.join(plugin, 'mcp-version.json'), 'utf8'));
    assert.equal(provenance.source.kind, 'release');
    assert.equal(provenance.upstream.tag, MCP_TAG);
});

test('a tagged source build records both the source tag and resolved commit', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'foldseek-mcp-import-test-'));
    const plugin = makePlugin(temp);
    const artifact = makeArtifact(temp);
    const result = importRuntime(plugin, artifact, { sourceKind: 'source-build', tag: MCP_TAG });
    assert.equal(result.status, 0, result.stderr);
    const provenance = JSON.parse(fs.readFileSync(path.join(plugin, 'mcp-version.json'), 'utf8'));
    assert.equal(provenance.source.kind, 'source-build');
    assert.equal(provenance.upstream.tag, MCP_TAG);
    assert.equal(provenance.upstream.commit, COMMIT);
});

test('the release tag must match the runtime package version', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'foldseek-mcp-import-test-'));
    const plugin = makePlugin(temp);
    const result = importRuntime(plugin, makeArtifact(temp), {
        sourceKind: 'release', tag: WRONG_MCP_TAG,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tag must identify the runtime package version/);
    assert.equal(fs.existsSync(path.join(plugin, '.mcp.json')), false);
});

test('a local build cannot claim an upstream release tag', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'foldseek-mcp-import-test-'));
    const plugin = makePlugin(temp);
    const result = importRuntime(plugin, makeArtifact(temp), { tag: MCP_TAG });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not valid for a local build/);
});
