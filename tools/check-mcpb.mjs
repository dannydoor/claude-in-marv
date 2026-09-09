#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'mcpb', 'manifest.json'), 'utf8'));
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'plugin', 'mcp-version.json'), 'utf8'));
const runtime = path.join(root, 'plugin', 'vendor', 'foldseek-server');
const contract = JSON.parse(fs.readFileSync(path.join(root, 'test', 'contract', 'mcp-interface.json'), 'utf8'));

assert.equal(manifest.name, 'foldseek-server', 'unexpected MCPB name');
assert.equal(manifest.version, provenance.version, 'MCPB and vendored runtime versions differ');
assert.equal(manifest.server?.type, 'node', 'MCPB must start a Node server');
assert.equal(manifest.server?.entry_point, 'scripts/foldseek-server-mcp.js', 'unexpected MCPB entry point');
assert.ok(fs.existsSync(path.join(runtime, manifest.server.entry_point)), 'MCPB entry point is absent from the runtime');
assert.deepEqual(manifest.server.mcp_config?.args, ['${__dirname}/scripts/foldseek-server-mcp.js']);
assert.deepEqual(manifest.server.mcp_config?.env, {
    FOLDSEEK_SERVER_BASE_URL: '${user_config.base_url}',
    FOLDSEEK_SERVER_STATE_DIR: '${user_config.state_dir}',
    FOLDSEEK_SERVER_SHARED_DIR: '${user_config.shared_dir}',
});
assert.equal(manifest.user_config?.base_url?.default, 'https://search.foldseek.com');
assert.equal(manifest.user_config?.state_dir?.default, '');
assert.equal(manifest.user_config?.shared_dir?.default, '');
assert.deepEqual(
    manifest.tools.map(tool => tool.name).sort(),
    Object.keys(contract).sort(),
    'MCPB tool list differs from the reviewed runtime contract',
);
assert.ok(fs.readFileSync(path.join(root, 'mcpb', 'README.md'), 'utf8').includes('Install Extension…'));

console.log(`foldseek-server MCPB ${manifest.version}: manifest matches the vendored runtime and ${manifest.tools.length} tools`);
