#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marketplacePath = path.join(root, '.claude-plugin', 'marketplace.json');
const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.match(marketplace.name, /^[a-z0-9][a-z0-9-]*$/, 'invalid marketplace name');
assert.ok(Array.isArray(marketplace.plugins) && marketplace.plugins.length > 0, 'marketplace has no plugins');
assert.ok(!Object.hasOwn(sourcePackage, 'version'),
    'keep the release version only in plugin/.claude-plugin/plugin.json');

const names = new Set();
for (const entry of marketplace.plugins) {
    assert.match(entry.name, /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/, `invalid plugin name: ${entry.name}`);
    assert.ok(!names.has(entry.name), `duplicate plugin name: ${entry.name}`);
    names.add(entry.name);

    assert.equal(typeof entry.source, 'string', `${entry.name}: source must be a relative path`);
    assert.ok(entry.source.startsWith('./'), `${entry.name}: source must start with ./`);
    const pluginDir = path.resolve(root, entry.source);
    assert.ok(pluginDir.startsWith(`${root}${path.sep}`), `${entry.name}: source leaves the repository`);

    const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.name, entry.name, `${entry.name}: manifest name differs`);
    assert.ok(!Object.hasOwn(entry, 'version'), `${entry.name}: keep the version only in plugin.json`);
    assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, `${entry.name}: invalid manifest version`);
}

console.log(`${marketplace.name}: ${marketplace.plugins.length} plugin entry validated`);
