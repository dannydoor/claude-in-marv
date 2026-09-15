#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commonRuntimeFiles = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'dist/server.mjs', 'package.json'];
const runtimeLayouts = ['scripts/marv-mcp.js', 'bin/marv-mcp.js']
    .map(entry => [...commonRuntimeFiles, entry].sort());
const upstreamRepository = 'https://github.com/soedinglab/MMseqs2-App';
const launcherSource = path.join(root, 'plugin', 'scripts', 'start-marv-api.mjs');

const fail = message => {
    console.error(`MCP import: ${message}`);
    process.exit(1);
};

function argumentsOf(argv) {
    const values = new Map();
    const allowed = new Set([
        '--artifact', '--sha256', '--source-kind', '--upstream-tag', '--upstream-commit', '--plugin-dir',
    ]);
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i];
        const value = argv[i + 1];
        if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
            fail('arguments must be supplied as --name value pairs');
        }
        if (!allowed.has(key)) fail(`unknown argument: ${key}`);
        if (values.has(key)) fail(`${key} was supplied more than once`);
        values.set(key, value);
    }
    for (const required of ['--artifact', '--sha256', '--source-kind', '--upstream-commit']) {
        if (!values.has(required)) fail(`${required} is required`);
    }
    return values;
}

const args = argumentsOf(process.argv.slice(2));
const artifact = path.resolve(args.get('--artifact'));
const expectedSha = args.get('--sha256').toLowerCase();
const sourceKind = args.get('--source-kind');
const upstreamTag = args.get('--upstream-tag') ?? null;
const upstreamCommit = args.get('--upstream-commit').toLowerCase();
const plugin = path.resolve(args.get('--plugin-dir') ?? path.join(root, 'plugin'));

if (!fs.statSync(artifact, { throwIfNoEntry: false })?.isFile()) fail(`artifact not found: ${artifact}`);
if (!/^[0-9a-f]{64}$/.test(expectedSha)) fail('--sha256 must be a 64-character hexadecimal digest');
if (!/^[0-9a-f]{40}$/.test(upstreamCommit)) fail('--upstream-commit must be a full Git commit');
if (!['local-build', 'source-build', 'release'].includes(sourceKind)) {
    fail('--source-kind must be local-build, source-build or release');
}
if (['source-build', 'release'].includes(sourceKind) && !upstreamTag) {
    fail('--upstream-tag is required for a tagged source or release artifact');
}
if (sourceKind === 'local-build' && upstreamTag) fail('--upstream-tag is not valid for a local build');

const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const actualSha = digest(artifact);
if (actualSha !== expectedSha) fail(`artifact SHA-256 is ${actualSha}, expected ${expectedSha}`);

const listing = spawnSync('unzip', ['-Z1', artifact], { encoding: 'utf8' });
if (listing.status !== 0) fail(`cannot list artifact: ${listing.stderr.trim()}`);
const members = listing.stdout.trim().split('\n').filter(Boolean).sort();
const runtimeFiles = runtimeLayouts.find(layout => JSON.stringify(layout) === JSON.stringify(members));
assert.ok(runtimeFiles, 'release artifact must contain exactly five runtime files in a supported layout');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'foldseek-mcp-import-'));
try {
    const runtime = path.join(temporary, 'runtime');
    fs.mkdirSync(runtime);
    const unpack = spawnSync('unzip', ['-q', artifact, '-d', runtime], { encoding: 'utf8' });
    if (unpack.status !== 0) fail(`cannot unpack artifact: ${unpack.stderr.trim()}`);
    for (const relative of runtimeFiles) {
        assert.ok(fs.lstatSync(path.join(runtime, relative)).isFile(), `${relative} must be a regular file`);
    }

    const runtimePackage = JSON.parse(fs.readFileSync(path.join(runtime, 'package.json'), 'utf8'));
    assert.equal(runtimePackage.name, 'marv-mcp', 'unexpected runtime package name');
    assert.match(runtimePackage.version ?? '', /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
        'runtime package needs a semantic version');
    assert.equal(runtimePackage.private, true, 'runtime package must be private and self-contained');
    if (['source-build', 'release'].includes(sourceKind)) {
        assert.equal(upstreamTag, `mcp-v${runtimePackage.version}`,
            'upstream tag must identify the runtime package version');
    }
    assert.equal(path.basename(artifact), `marv-api-runtime-v${runtimePackage.version}.zip`,
        'artifact filename must identify the runtime package version');

    const config = {
        mcpServers: {
            'Marv API': {
                command: 'node',
                args: ['${CLAUDE_PLUGIN_ROOT}/scripts/start-marv-api.mjs'],
                env: {
                    MARV_BASE_URL: '${user_config.base_url}',
                    MARV_STATE_DIR: '${CLAUDE_PLUGIN_DATA}/state',
                    MARV_SHARED_DIR: '${user_config.shared_dir}',
                },
            },
        },
    };
    const userConfig = {
        base_url: {
            type: 'string',
            title: 'Server URL',
            description: 'Foldseek Search Server deployment used for searches.',
            required: false,
            default: 'https://search.foldseek.com',
        },
        shared_dir: {
            type: 'directory',
            title: 'Shared folder override',
            description: 'Optional folder used for exports and uploaded inputs. If empty, a marv-shared folder under the current user\'s home is used. Grant the active Claude session access before exporting.',
            required: false,
            default: '',
        },
    };
    const sourceManifest = path.join(plugin, '.claude-plugin', 'plugin.json');
    const manifest = JSON.parse(fs.readFileSync(sourceManifest, 'utf8'));
    manifest.userConfig = userConfig;

    const files = Object.fromEntries(runtimeFiles.map(relative => [relative, digest(path.join(runtime, relative))]));
    const provenance = {
        name: runtimePackage.name,
        version: runtimePackage.version,
        source: { kind: sourceKind },
        upstream: { repository: upstreamRepository, tag: upstreamTag, commit: upstreamCommit },
        artifact: { name: path.basename(artifact), sha256: actualSha },
        files,
    };

    const stagedPlugin = path.join(temporary, 'plugin');
    fs.mkdirSync(path.join(stagedPlugin, '.claude-plugin'), { recursive: true });
    fs.mkdirSync(path.join(stagedPlugin, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(stagedPlugin, 'vendor'), { recursive: true });
    fs.copyFileSync(launcherSource, path.join(stagedPlugin, 'scripts', 'start-marv-api.mjs'));
    fs.cpSync(runtime, path.join(stagedPlugin, 'vendor', 'marv-api'), { recursive: true });
    const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    writeJson(path.join(stagedPlugin, '.claude-plugin', 'plugin.json'), manifest);
    writeJson(path.join(stagedPlugin, '.mcp.json'), config);
    writeJson(path.join(stagedPlugin, 'mcp-version.json'), provenance);

    const check = spawnSync(process.execPath,
        [path.join(root, 'tools', 'check-mcp-runtime.mjs'), '--plugin-dir', stagedPlugin, '--required'],
        { encoding: 'utf8' });
    if (check.status !== 0) fail(check.stderr.trim() || check.stdout.trim() || 'staged runtime validation failed');

    fs.rmSync(path.join(plugin, 'vendor', 'marv-api'), { recursive: true, force: true });
    fs.mkdirSync(path.join(plugin, 'vendor'), { recursive: true });
    fs.cpSync(path.join(stagedPlugin, 'vendor', 'marv-api'),
        path.join(plugin, 'vendor', 'marv-api'), { recursive: true });
    for (const relative of [
        '.mcp.json', 'mcp-version.json', '.claude-plugin/plugin.json', 'scripts/start-marv-api.mjs',
    ]) {
        fs.mkdirSync(path.dirname(path.join(plugin, relative)), { recursive: true });
        fs.copyFileSync(path.join(stagedPlugin, relative), path.join(plugin, relative));
    }

    const source = sourceKind === 'local-build' ? `local build of ${upstreamCommit}` : `${sourceKind} from ${upstreamTag}`;
    console.log(`Imported ${runtimePackage.name} v${runtimePackage.version} from ${source} (${actualSha})`);
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}
