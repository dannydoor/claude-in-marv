import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHECK = path.join(ROOT, 'tools', 'check-mcp-runtime.mjs');
const LAUNCHER = path.join(ROOT, 'plugin', 'scripts', 'start-foldseek-server.mjs');
const PLUGIN_VERSION = '7.8.9';
const MCP_VERSION = '4.5.6';
const run = (plugin, ...args) => spawnSync(process.execPath,
    [CHECK, '--plugin-dir', plugin, ...args], { encoding: 'utf8' });
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function stageRuntime() {
    const plugin = fs.mkdtempSync(path.join(os.tmpdir(), 'foldseek-plugin-runtime-'));
    const runtime = path.join(plugin, 'vendor', 'foldseek-server');
    for (const directory of ['scripts', 'dist']) fs.mkdirSync(path.join(runtime, directory), { recursive: true });
    fs.mkdirSync(path.join(plugin, '.claude-plugin'));
    fs.mkdirSync(path.join(plugin, 'scripts'));

    fs.writeFileSync(path.join(runtime, 'LICENSE'), 'GPL-3.0-or-later\n');
    fs.writeFileSync(path.join(runtime, 'THIRD_PARTY_NOTICES.md'), '# Third-party notices\n');
    fs.writeFileSync(path.join(runtime, 'scripts', 'foldseek-server-mcp.js'), '#!/usr/bin/env node\n');
    fs.writeFileSync(path.join(runtime, 'dist', 'server.mjs'),
        "import fs from 'node:fs';\nexport const available = Boolean(fs);\n");
    fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({
        name: 'foldseek-server-mcp', version: MCP_VERSION, private: true, type: 'module',
    }));
    fs.copyFileSync(LAUNCHER, path.join(plugin, 'scripts', 'start-foldseek-server.mjs'));
    fs.writeFileSync(path.join(plugin, '.mcp.json'), JSON.stringify({ mcpServers: {
        'foldseek-server': {
            command: 'node',
            args: ['${CLAUDE_PLUGIN_ROOT}/scripts/start-foldseek-server.mjs'],
            env: {
                FOLDSEEK_SERVER_BASE_URL: '${user_config.base_url}',
                FOLDSEEK_SERVER_STATE_DIR: '${CLAUDE_PLUGIN_DATA}/state',
                FOLDSEEK_SERVER_SHARED_DIR: '${user_config.shared_dir}',
            },
        },
    } }));
    fs.writeFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({
        name: 'foldseek-server', version: PLUGIN_VERSION, userConfig: {
            base_url: {
                type: 'string', title: 'Server URL',
                description: 'Foldseek Server deployment used for searches.',
                required: false, default: 'https://search.foldseek.com',
            },
            shared_dir: {
                type: 'directory', title: 'Shared folder override',
                description: 'Optional folder used for exports and uploaded inputs. If empty, a foldseek-server-shared folder under the current user\'s home is used. Grant the active Claude session access before exporting.',
                required: false, default: '',
            },
        },
    }));

    const updateProvenance = () => {
        const files = {};
        for (const relative of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'scripts/foldseek-server-mcp.js', 'dist/server.mjs', 'package.json']) {
            files[relative] = digest(path.join(runtime, relative));
        }
        fs.writeFileSync(path.join(plugin, 'mcp-version.json'), JSON.stringify({
            name: 'foldseek-server-mcp',
            version: MCP_VERSION,
            source: { kind: 'local-build' },
            upstream: {
                repository: 'https://github.com/soedinglab/MMseqs2-App',
                tag: null,
                commit: 'a'.repeat(40),
            },
            artifact: { name: `foldseek-server-plugin-runtime-v${MCP_VERSION}.zip`, sha256: 'b'.repeat(64) },
            files,
        }));
    };
    updateProvenance();
    return { plugin, runtime, updateProvenance };
}

test('an absent runtime is valid during development but not for a release', () => {
    const plugin = fs.mkdtempSync(path.join(os.tmpdir(), 'foldseek-plugin-empty-'));
    assert.equal(run(plugin).status, 0);
    assert.notEqual(run(plugin, '--required').status, 0);
});

test('a partial runtime update is refused', () => {
    const plugin = fs.mkdtempSync(path.join(os.tmpdir(), 'foldseek-plugin-partial-'));
    fs.writeFileSync(path.join(plugin, '.mcp.json'), '{}');
    assert.notEqual(run(plugin).status, 0);
});

test('the five-file self-contained runtime and its provenance pass together', () => {
    const { plugin } = stageRuntime();
    const result = run(plugin, '--required');
    assert.equal(result.status, 0, result.stderr);
});

test('a runtime with an external package import is refused', () => {
    const { plugin, runtime, updateProvenance } = stageRuntime();
    fs.writeFileSync(path.join(runtime, 'dist', 'server.mjs'), "import leftPad from 'left-pad';\n");
    updateProvenance();
    const result = run(plugin, '--required');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not self-contained/);
});

test('an extra vendored file is refused', () => {
    const { plugin, runtime } = stageRuntime();
    fs.mkdirSync(path.join(runtime, 'node_modules'));
    fs.writeFileSync(path.join(runtime, 'node_modules', 'extra.js'), '');
    const result = run(plugin, '--required');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exactly five release files/);
});

test('URL strings do not corrupt the bundled import check', () => {
    const { plugin, runtime, updateProvenance } = stageRuntime();
    fs.writeFileSync(path.join(runtime, 'dist', 'server.mjs'), [
        "import fs from 'node:fs';",
        "const endpoint = 'https://example.test';",
        "const prose = \"from 'left-pad' is only text\";",
        'export { endpoint, fs, prose };',
        '',
    ].join('\n'));
    updateProvenance();
    const result = run(plugin, '--required');
    assert.equal(result.status, 0, result.stderr);
});
