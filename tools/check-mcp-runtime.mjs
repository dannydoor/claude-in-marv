#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginArg = process.argv.indexOf('--plugin-dir');
const plugin = pluginArg === -1 ? path.join(root, 'plugin') : path.resolve(process.argv[pluginArg + 1] ?? '');
if (pluginArg !== -1 && !process.argv[pluginArg + 1]) {
    console.error('MCP runtime: --plugin-dir requires a path');
    process.exit(1);
}
const configPath = path.join(plugin, '.mcp.json');
const provenancePath = path.join(plugin, 'mcp-version.json');
const launcherPath = path.join(plugin, 'scripts', 'start-marv-api.mjs');
const runtimeRoot = path.join(plugin, 'vendor', 'marv-api');
const manifestPath = path.join(plugin, '.claude-plugin', 'plugin.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const required = process.argv.includes('--required');
const present = [configPath, provenancePath, launcherPath, runtimeRoot]
    .map(fs.existsSync).concat(manifest.userConfig !== undefined);
const commonRuntimeFiles = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'dist/server.mjs', 'package.json'];
const runtimeLayouts = ['scripts/marv-mcp.js', 'bin/marv-mcp.js']
    .map(entry => [...commonRuntimeFiles, entry].sort());

const fail = (message) => {
    console.error(`MCP runtime: ${message}`);
    process.exit(1);
};

if (present.every((value) => !value)) {
    if (required) fail('release requires the bundled Foldseek MCP runtime');
    console.log('MCP runtime not bundled yet; no partial bundle present');
    process.exit(0);
}

assert.ok(present.every(Boolean),
    'bundle .mcp.json, launcher, mcp-version.json, plugin userConfig and vendor/marv-api atomically');

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const server = config.mcpServers?.['Marv API'];
assert.ok(server, '.mcp.json must declare mcpServers["Marv API"]');
assert.equal(server.command, 'node', 'bundled server command must be node');
assert.deepEqual(
    server.args,
    ['${CLAUDE_PLUGIN_ROOT}/scripts/start-marv-api.mjs'],
    'bundled server must run through the plugin launcher',
);
assert.deepEqual(server.env, {
    MARV_BASE_URL: '${user_config.base_url}',
    MARV_STATE_DIR: '${CLAUDE_PLUGIN_DATA}/state',
    MARV_SHARED_DIR: '${user_config.shared_dir}',
}, 'bundled server environment must use plugin configuration and persistent plugin data');
assert.deepEqual(manifest.userConfig, {
    base_url: {
        type: 'string', title: 'Server URL',
        description: 'Foldseek Search Server deployment used for searches.',
        required: false, default: 'https://search.foldseek.com',
    },
    shared_dir: {
        type: 'directory', title: 'Shared folder override',
        description: 'Optional folder used for exports and uploaded inputs. If empty, a marv-shared folder under the current user\'s home is used. Grant the active Claude session access before exporting.',
        required: false, default: '',
    },
}, 'plugin userConfig must expose the two supported MCP settings');

const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
assert.equal(provenance.name, 'marv-mcp', 'unexpected bundled server name');
assert.match(provenance.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'invalid bundled server version');
assert.ok(['local-build', 'source-build', 'release'].includes(provenance.source?.kind),
    'runtime source kind must be local-build, source-build or release');
assert.equal(provenance.upstream?.repository, 'https://github.com/soedinglab/MMseqs2-App', 'unexpected upstream repository');
if (['source-build', 'release'].includes(provenance.source.kind)) {
    assert.equal(provenance.upstream?.tag, `mcp-v${provenance.version}`,
        'source tag must match the runtime version');
} else {
    assert.equal(provenance.upstream?.tag, null, 'a local build must not claim an upstream tag');
}
assert.match(provenance.upstream?.commit ?? '', /^[0-9a-f]{40}$/, 'upstream commit must be a full Git hash');
assert.match(provenance.artifact?.sha256 ?? '', /^[0-9a-f]{64}$/, 'artifact SHA-256 is required');
assert.equal(provenance.artifact?.name, `marv-api-runtime-v${provenance.version}.zip`,
    'artifact filename must match the runtime version');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
});
const actualFiles = walk(runtimeRoot)
    .map((file) => path.relative(runtimeRoot, file).split(path.sep).join('/'))
    .sort();
const runtimeFiles = runtimeLayouts.find(layout => JSON.stringify(layout) === JSON.stringify(actualFiles));
assert.ok(runtimeFiles, 'vendored runtime must contain exactly five release files in a supported layout');

assert.deepEqual(Object.keys(provenance.files ?? {}).sort(), runtimeFiles, 'provenance must hash every runtime file');
for (const relative of runtimeFiles) {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(runtimeRoot, relative))).digest('hex');
    assert.equal(digest, provenance.files[relative], `${relative} differs from its recorded SHA-256`);
}

const runtimePackage = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'package.json'), 'utf8'));
assert.equal(runtimePackage.name, provenance.name, 'runtime package name differs from provenance');
assert.equal(runtimePackage.version, provenance.version, 'runtime package version differs from provenance');
assert.equal(runtimePackage.private, true, 'vendored runtime must come from the private upstream workspace');

function moduleSpecifiers(code) {
    const found = [];
    const identifier = /[A-Za-z0-9_$]/;
    const skipString = start => {
        const quote = code[start];
        let value = '';
        let i = start + 1;
        for (; i < code.length; i += 1) {
            if (code[i] === '\\') { value += code[i] + (code[i + 1] ?? ''); i += 1; continue; }
            if (code[i] === quote) return { value, end: i + 1 };
            value += code[i];
        }
        return { value, end: i };
    };
    const skipSpaceAndComments = start => {
        let i = start;
        for (;;) {
            while (/\s/.test(code[i] ?? '')) i += 1;
            if (code.slice(i, i + 2) === '//') {
                i = code.indexOf('\n', i + 2);
                if (i === -1) return code.length;
            } else if (code.slice(i, i + 2) === '/*') {
                const end = code.indexOf('*/', i + 2);
                i = end === -1 ? code.length : end + 2;
            } else return i;
        }
    };
    const skipComment = start => {
        if (code.slice(start, start + 2) === '//') {
            const end = code.indexOf('\n', start + 2);
            return end === -1 ? code.length : end + 1;
        }
        const end = code.indexOf('*/', start + 2);
        return end === -1 ? code.length : end + 2;
    };

    for (let i = 0; i < code.length;) {
        if (code.slice(i, i + 2) === '//' || code.slice(i, i + 2) === '/*') {
            i = skipComment(i);
            continue;
        }
        if (code[i] === "'" || code[i] === '"' || code[i] === '`') {
            i = skipString(i).end;
            continue;
        }
        if (code.startsWith('import', i) && !identifier.test(code[i - 1] ?? '') &&
            !identifier.test(code[i + 6] ?? '')) {
            let j = skipSpaceAndComments(i + 6);
            if (code[j] === '.') { i = j + 1; continue; }
            if (code[j] === '(') {
                j = skipSpaceAndComments(j + 1);
                if (code[j] === "'" || code[j] === '"') found.push(skipString(j).value);
                i = j + 1;
                continue;
            }
            if (code[j] === "'" || code[j] === '"') {
                const string = skipString(j);
                found.push(string.value);
                i = string.end;
                continue;
            }
            for (; j < code.length && code[j] !== ';';) {
                if (code.slice(j, j + 2) === '//' || code.slice(j, j + 2) === '/*') {
                    j = skipComment(j);
                    continue;
                }
                if (code[j] === "'" || code[j] === '"' || code[j] === '`') {
                    j = skipString(j).end;
                    continue;
                }
                if (code.startsWith('from', j) && !identifier.test(code[j - 1] ?? '') &&
                    !identifier.test(code[j + 4] ?? '')) {
                    const at = skipSpaceAndComments(j + 4);
                    if (code[at] === "'" || code[at] === '"') {
                        const string = skipString(at);
                        found.push(string.value);
                        j = string.end;
                        break;
                    }
                }
                j += 1;
            }
            i = j + 1;
            continue;
        }
        i += 1;
    }
    return found;
}

const bundle = fs.readFileSync(path.join(runtimeRoot, 'dist', 'server.mjs'), 'utf8');
const imports = moduleSpecifiers(bundle);
assert.ok(imports.every((specifier) => specifier.startsWith('node:')),
    `server.mjs is not self-contained: ${imports.filter((specifier) => !specifier.startsWith('node:')).join(', ')}`);

console.log(`${provenance.name} v${provenance.version}: bundled runtime validated`);
