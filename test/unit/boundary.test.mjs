import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmp } from '../support/temp.mjs';

import { checkBoundary, classify, SHIP } from '../../tools/boundary.mjs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const PLUGIN = path.join(ROOT, 'plugin');

function copyPlugin() {
    const destination = path.join(tmp('boundary-'), 'plugin');
    fs.cpSync(PLUGIN, destination, { recursive: true });
    return destination;
}

function append(relative, text) {
    const plugin = copyPlugin();
    fs.appendFileSync(path.join(plugin, relative), `\n${text}\n`);
    return checkBoundary(plugin).findings;
}

test('the public plugin tree is completely classified and clean', () => {
    const { all, shipped, rejected } = classify(PLUGIN);
    const checked = checkBoundary(PLUGIN);
    assert.equal(all.length, shipped.length + rejected.length);
    assert.deepEqual(checked.unclassified, []);
    assert.deepEqual(checked.findings, []);
    for (const required of ['.claude-plugin/plugin.json', 'CHANGELOG.md', 'LICENSE']) {
        assert.ok(shipped.includes(required), `${required} is not shipped`);
    }
});

test('tests and fixtures placed under the analysis source cannot ship', () => {
    const plugin = copyPlugin();
    for (const relative of ['analysis/src/check.test.mjs', 'analysis/src/fixtures/data.mjs']) {
        fs.mkdirSync(path.dirname(path.join(plugin, relative)), { recursive: true });
        fs.writeFileSync(path.join(plugin, relative), 'export default {};\n');
    }
    const { shipped, rejected } = classify(plugin);
    assert.equal(shipped.some(file => /(?:\.test\.mjs|\/fixtures\/)/.test(file)), false);
    assert.ok(rejected.some(entry => entry.path === 'analysis/src/check.test.mjs'));
    assert.ok(rejected.some(entry => entry.path === 'analysis/src/fixtures/data.mjs'));
});

test('unclassified skill helpers and imports missing from the archive are findings', () => {
    const plugin = copyPlugin();
    fs.writeFileSync(path.join(plugin, 'skills', 'helper.mjs'), 'export const value = 1;\n');
    const target = path.join(plugin, 'analysis', 'src', 'io', 'write.mjs');
    fs.writeFileSync(target, `import './missing.mjs';\n${fs.readFileSync(target, 'utf8')}`);
    const findings = checkBoundary(plugin).findings.join('\n');
    assert.match(findings, /skills\/helper\.mjs is neither shipped nor explicitly rejected/);
    assert.match(findings, /imports \.\/missing\.mjs, which is not in the archive/);
});

test('shipped analysis cannot add network, process or host-specific dependencies', () => {
    for (const source of [
        "import http from 'node:http';",
        "import request from 'undici';",
        'process.env.HOME;',
        'await execSync("command");',
        "const path = '/Users/example/private';",
    ]) {
        const findings = append('analysis/src/io/write.mjs', source);
        assert.ok(findings.length > 0, source);
    }
});

test('shipped guidance cannot depend on browser APIs or repository-only documents', () => {
    for (const prose of [
        'Read window.searchApi directly.',
        'See docs/architecture.md.',
        'See mcp-migration/plan.md.',
    ]) {
        const findings = append('CHANGELOG.md', prose);
        assert.ok(findings.length > 0, prose);
    }
});

test('the MCP payload admits configuration, launcher and the reviewed runtime only', () => {
    for (const relative of [
        '.mcp.json',
        'mcp-version.json',
        'scripts/start-foldseek-server.mjs',
        'vendor/foldseek-server/LICENSE',
        'vendor/foldseek-server/THIRD_PARTY_NOTICES.md',
        'vendor/foldseek-server/scripts/foldseek-server-mcp.js',
        'vendor/foldseek-server/dist/server.mjs',
        'vendor/foldseek-server/package.json',
    ]) {
        assert.ok(SHIP.some(rule => rule.test(relative)), relative);
    }
    for (const relative of [
        'vendor/foldseek-server/src/server.js',
        'vendor/foldseek-server/test/runtime.test.js',
        'vendor/foldseek-server/node_modules/sdk/index.js',
        'vendor/foldseek-server/README.md',
    ]) {
        assert.equal(SHIP.some(rule => rule.test(relative)), false, relative);
    }
});
