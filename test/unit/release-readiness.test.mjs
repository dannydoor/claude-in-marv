import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { releaseMetadataErrors } from '../../tools/check-release.mjs';
import { syncMcpMetadata } from '../../tools/sync-mcp-metadata.mjs';

const PLUGIN_VERSION = '7.8.9';
const MCP_VERSION = '4.5.6';
const REPOSITORY = 'example-owner/example-plugin';

function repository() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foldseek-release-metadata-'));
    fs.mkdirSync(path.join(root, 'plugin', '.claude-plugin'), { recursive: true });
    fs.mkdirSync(path.join(root, 'mcpb'));
    fs.writeFileSync(path.join(root, 'plugin', '.claude-plugin', 'plugin.json'), JSON.stringify({
        name: 'claude-in-marv', version: PLUGIN_VERSION,
    }));
    fs.writeFileSync(path.join(root, 'plugin', 'CHANGELOG.md'),
        `# Changelog\n\n## ${PLUGIN_VERSION} — 2099-01-02\n`);
    fs.writeFileSync(path.join(root, 'plugin', 'mcp-version.json'), JSON.stringify({ version: MCP_VERSION }));
    fs.writeFileSync(path.join(root, 'mcpb', 'manifest.json'), JSON.stringify({ version: '0.0.0' }));
    fs.writeFileSync(path.join(root, 'README.md'), [
        `/plugin marketplace add ${REPOSITORY}`,
        '/plugin install claude-in-marv@steinegger-lab',
        '[Download `marv-api-v0.0.0.mcpb`](https://github.com/old-owner/old-plugin/releases/download/v0.0.0/marv-api-v0.0.0.mcpb)',
        'Plugin 0.0.0 requires MCPB 0.0.0.',
    ].join('\n'));
    return root;
}

const check = (root, overrides = {}) => releaseMetadataErrors({
    repositoryRoot: root,
    tag: `v${PLUGIN_VERSION}`,
    repository: REPOSITORY,
    ...overrides,
});

test('release metadata follows the manifest, runtime provenance and selected repository', () => {
    const root = repository();
    syncMcpMetadata({ repositoryRoot: root, repository: REPOSITORY });
    assert.deepEqual(check(root), []);
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    assert.match(readme, new RegExp(`github\\.com/${REPOSITORY}/releases/download/v${PLUGIN_VERSION}/`));
    assert.match(readme, new RegExp(`Plugin ${PLUGIN_VERSION} requires MCPB ${MCP_VERSION}\\.`));
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'mcpb', 'manifest.json'))).version, MCP_VERSION);
});

test('stale release inputs are rejected from values supplied at run time', () => {
    const root = repository();
    syncMcpMetadata({ repositoryRoot: root, repository: REPOSITORY });
    fs.writeFileSync(path.join(root, 'plugin', 'CHANGELOG.md'),
        `# Changelog\n\n## ${PLUGIN_VERSION} — unreleased\n`);
    const errors = check(root, { tag: 'v9.9.9', repository: 'new-owner/new-plugin' });
    assert.ok(errors.some(error => /tag must equal/.test(error)));
    assert.ok(errors.some(error => /CHANGELOG must date/.test(error)));
    assert.ok(errors.some(error => /marketplace add new-owner\/new-plugin/.test(error)));
});
