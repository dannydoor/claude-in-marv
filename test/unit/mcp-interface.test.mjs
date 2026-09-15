import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHECK = path.join(ROOT, 'tools', 'check-mcp-interface.mjs');

function fixture(layout = 'bin') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foldseek-interface-test-'));
    const plugin = path.join(root, 'plugin');
    const entryDir = path.join(plugin, 'vendor', 'marv-api', layout);
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, 'marv-mcp.js'), `
const readline = require('node:readline');
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => {
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {
            protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fixture', version: '1' }
        } }) + '\\n');
    }
    if (message.method === 'tools/list') {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [{
            name: 'alpha', description: 'Descriptions do not change the callable contract.',
            inputSchema: { type: 'object', properties: { x: { type: 'string', description: 'ignored' } }, required: ['x'] }
        }] } }) + '\\n');
    }
    if (message.method === 'tools/call' && message.params.name === 'get_shared_dir') {
        const path = require('node:path');
        const shared = process.env.MARV_SHARED_DIR;
        const described = {
            localPath: shared,
            mountName: path.basename(shared),
            imports: { localPath: path.join(shared, 'imports'), pathFromMount: 'imports' },
            exports: { localPath: path.join(shared, 'exports'), pathFromMount: 'exports' },
        };
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {
            content: [{ type: 'text', text: JSON.stringify(described) }], isError: false
        } }) + '\\n');
    }
});
`);
    const contract = path.join(root, 'contract.json');
    fs.writeFileSync(contract, `${JSON.stringify({
        alpha: { required: ['x'], properties: { x: { type: 'string' } }, type: 'object' },
    }, null, 2)}\n`);
    return { root, plugin, contract };
}

const run = ({ plugin, contract }, extra = []) => spawnSync(process.execPath,
    [CHECK, '--plugin-dir', plugin, '--contract', contract, ...extra], { encoding: 'utf8' });

test('the vendored server is started and its callable tool schema matches the reviewed contract', () => {
    const item = fixture();
    const result = run(item, ['--required']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 MCP tool schemas match the reviewed contract/);
});

test('the plugin-runtime scripts layout is checked too', () => {
    const item = fixture('scripts');
    const result = run(item, ['--required']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 MCP tool schemas match the reviewed contract/);
});

test('a tool-schema change is a named failure', () => {
    const item = fixture();
    fs.writeFileSync(item.contract, JSON.stringify({
        alpha: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
    }));
    const result = run(item, ['--required']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tool contract changed: alpha/);
});

test('development may omit the runtime, while a release may not', () => {
    const item = fixture();
    fs.rmSync(path.join(item.plugin, 'vendor'), { recursive: true });
    assert.equal(run(item).status, 0);
    const required = run(item, ['--required']);
    assert.notEqual(required.status, 0);
    assert.match(required.stderr, /release requires the bundled/);
});
