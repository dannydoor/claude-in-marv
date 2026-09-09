#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const valueAfter = (name, fallback) => {
    const at = process.argv.indexOf(name);
    if (at === -1) return fallback;
    if (!process.argv[at + 1]) throw new Error(`${name} requires a value`);
    return path.resolve(process.argv[at + 1]);
};
const plugin = valueAfter('--plugin-dir', path.join(root, 'plugin'));
const contractPath = valueAfter('--contract', path.join(root, 'test', 'contract', 'mcp-interface.json'));
const required = process.argv.includes('--required');
const entry = [
    path.join(plugin, 'vendor', 'foldseek-server', 'scripts', 'foldseek-server-mcp.js'),
    path.join(plugin, 'vendor', 'foldseek-server', 'bin', 'foldseek-server-mcp.js'),
].find(fs.existsSync);

const fail = message => {
    console.error(`MCP interface: ${message}`);
    process.exit(1);
};

if (!entry) {
    if (required) fail('release requires the bundled Foldseek MCP runtime');
    console.log('MCP interface not checked yet; no bundled runtime present');
    process.exit(0);
}

const canonical = value => {
    if (Array.isArray(value)) {
        const values = value.map(canonical);
        return values.every(item => item === null || ['boolean', 'number', 'string'].includes(typeof item))
            ? values.sort((left, right) => String(left).localeCompare(String(right)))
            : values;
    }
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().filter(key =>
        !['default', 'description', 'title'].includes(key)).map(key => [key, canonical(value[key])]));
};

async function toolsFromRuntime() {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'foldseek-mcp-interface-'));
    const shared = path.join(state, 'shared');
    const env = {
        ...process.env,
        FOLDSEEK_SERVER_BASE_URL: 'http://127.0.0.1:9',
        FOLDSEEK_SERVER_STATE_DIR: state,
        FOLDSEEK_SERVER_SHARED_DIR: shared,
    };
    const child = spawn(process.execPath, [entry], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    const pending = new Map();
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (message.id !== undefined && pending.has(message.id)) {
            const { resolve, reject, timer } = pending.get(message.id);
            pending.delete(message.id);
            clearTimeout(timer);
            if (message.error) reject(new Error(JSON.stringify(message.error)));
            else resolve(message.result);
        }
    });
    child.on('exit', code => {
        for (const { reject, timer } of pending.values()) {
            clearTimeout(timer);
            reject(new Error(`server exited ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
        }
        pending.clear();
    });
    const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
    const request = (id, method, params = {}) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`${method} did not answer within 5 seconds`));
        }, 5000);
        pending.set(id, { resolve, reject, timer });
        send({ jsonrpc: '2.0', id, method, params });
    });

    try {
        await request(1, 'initialize', {
            protocolVersion: '2025-06-18', capabilities: {},
            clientInfo: { name: 'foldseek-plugin-interface-check', version: '1' },
        });
        send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
        const tools = (await request(2, 'tools/list')).tools;
        const response = await request(3, 'tools/call', {
            name: 'get_shared_dir', arguments: {},
        });
        if (response.isError) throw new Error(`get_shared_dir failed: ${response.content?.[0]?.text}`);
        const described = JSON.parse(response.content?.[0]?.text ?? '{}');
        if (described.localPath !== shared ||
            described.imports?.localPath !== path.join(shared, 'imports') ||
            described.exports?.localPath !== path.join(shared, 'exports') ||
            'configured' in described || 'sessionAccess' in described) {
            throw new Error('get_shared_dir did not report the verified shared layout');
        }
        return tools;
    } finally {
        lines.close();
        child.stdin.end();
        child.kill();
        fs.rmSync(state, { recursive: true, force: true });
    }
}

let expected;
try {
    expected = canonical(JSON.parse(fs.readFileSync(contractPath, 'utf8')));
} catch (error) {
    fail(`cannot read ${contractPath}: ${error.message}`);
}

const contractOf = tools => {
    const contract = {};
    for (const tool of tools) {
        if (Object.hasOwn(contract, tool.name)) fail(`runtime exposes ${tool.name} more than once`);
        contract[tool.name] = canonical(tool.inputSchema);
    }
    return canonical(contract);
};
const compare = (label, wanted, actual) => {
    const changed = [...new Set([...Object.keys(wanted), ...Object.keys(actual)])].sort()
        .filter(name => JSON.stringify(wanted[name]) !== JSON.stringify(actual[name]));
    if (changed.length) fail(`${label} tool contract changed: ${changed.join(', ')}`);
};

let actual;
try {
    actual = contractOf(await toolsFromRuntime());
} catch (error) {
    fail(error.message);
}
compare('runtime', expected, actual);

console.log(`${Object.keys(actual).length} MCP tool schemas match the reviewed contract`);
