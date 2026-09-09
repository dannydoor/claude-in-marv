#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '..');

export function syncMcpMetadata({ repositoryRoot, repository }) {
    assert.match(repository ?? '', /^[^/\s]+\/[^/\s]+$/, 'repository must be OWNER/REPOSITORY');
    const plugin = JSON.parse(fs.readFileSync(
        path.join(repositoryRoot, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'));
    const runtime = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'plugin', 'mcp-version.json'), 'utf8'));
    const mcpbPath = path.join(repositoryRoot, 'mcpb', 'manifest.json');
    const mcpb = JSON.parse(fs.readFileSync(mcpbPath, 'utf8'));
    mcpb.version = runtime.version;
    fs.writeFileSync(mcpbPath, `${JSON.stringify(mcpb, null, 2)}\n`);

    const readmePath = path.join(repositoryRoot, 'README.md');
    let readme = fs.readFileSync(readmePath, 'utf8');
    const download = /\[Download `foldseek-server-v[^`]+\.mcpb`\]\(https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/releases\/download\/v[^/]+\/foldseek-server-v[^)]+\.mcpb\)/;
    const compatibility = /^Plugin \S+ requires MCPB \S+\.$/m;
    assert.match(readme, download, 'README MCPB download link was not found');
    assert.match(readme, compatibility, 'README plugin/MCPB compatibility sentence was not found');
    readme = readme.replace(download,
        `[Download \`foldseek-server-v${runtime.version}.mcpb\`](https://github.com/${repository}/releases/download/v${plugin.version}/foldseek-server-v${runtime.version}.mcpb)`);
    readme = readme.replace(compatibility, `Plugin ${plugin.version} requires MCPB ${runtime.version}.`);
    fs.writeFileSync(readmePath, readme);
    return { pluginVersion: plugin.version, runtimeVersion: runtime.version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
    const repositoryArg = process.argv.indexOf('--repository');
    const repository = repositoryArg >= 0 ? process.argv[repositoryArg + 1] : process.env.GITHUB_REPOSITORY;
    const result = syncMcpMetadata({ repositoryRoot: root, repository });
    console.log(`MCPB and README now name runtime ${result.runtimeVersion} for plugin ${result.pluginVersion}`);
}
