#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = path.join(root, 'plugin', 'vendor', 'foldseek-server');
const provenance = JSON.parse(await fs.readFile(path.join(root, 'plugin', 'mcp-version.json'), 'utf8'));
const out = path.resolve(process.argv[2] ?? path.join(root, 'dist', `foldseek-server-v${provenance.version}.mcpb`));
const runtimeFiles = Object.keys(provenance.files ?? {}).sort();
const extensionFiles = ['README.md', 'manifest.json'];
const expected = [...runtimeFiles, ...extensionFiles].sort();

execFileSync(process.execPath, [path.join(root, 'tools', 'check-mcpb.mjs')], { stdio: 'inherit' });

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'foldseek-server-mcpb-'));
try {
    const stage = path.join(temporary, 'extension');
    await fs.mkdir(stage);
    for (const relative of runtimeFiles) {
        const target = path.join(stage, relative);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(path.join(runtimeRoot, relative), target);
    }
    for (const relative of extensionFiles) {
        await fs.copyFile(path.join(root, 'mcpb', relative), path.join(stage, relative));
    }

    await fs.mkdir(path.dirname(out), { recursive: true });
    execFileSync('npx', ['--yes', '@anthropic-ai/mcpb@2.1.2', 'pack', stage, out], { cwd: root, stdio: 'inherit' });
    const actual = execFileSync('unzip', ['-Z1', out], { encoding: 'utf8' }).trim().split('\n').sort();
    assert.deepEqual(actual, expected, 'MCPB packer output differs from the explicit release set');
    for (const relative of expected) {
        assert.deepEqual(
            execFileSync('unzip', ['-p', out, relative]),
            await fs.readFile(path.join(stage, relative)),
            `${relative} in the MCPB differs from its reviewed source`,
        );
    }
    process.stderr.write(`${out}  ${((await fs.stat(out)).size / 1024).toFixed(0)} KB\n`);
} finally {
    await fs.rm(temporary, { recursive: true, force: true });
}
