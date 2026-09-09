#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const excludedDirs = new Set(['.git', 'dist', 'node_modules']);
const intentionalPathFixtures = new Set(['test/unit/boundary.test.mjs']);
const sensitiveNames = /(?:^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:pem|key)|\.DS_Store)$/;
const sensitiveText = [
    { label: 'a private home path', re: /\/(?:Users|home)\/[A-Za-z0-9._-]+\// },
    { label: 'a private key', re: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/ },
    { label: 'an authorization header', re: /Authorization:\s*(?:Bearer|Basic)\s+\S+/i },
    { label: 'a GitHub token', re: /(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}/ },
    { label: 'an API secret', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
];
const maxFileBytes = 5 * 1024 * 1024;

const isIgnoredSidecar = (relative) => path.basename(relative) === '.DS_Store'
    && spawnSync('git', ['check-ignore', '-q', '--', relative], { cwd: root }).status === 0;

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && excludedDirs.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
});

const findings = [];
for (const file of walk(root)) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (isIgnoredSidecar(relative)) continue;
    const stat = fs.statSync(file);
    if (sensitiveNames.test(relative)) findings.push(`${relative}: sensitive file name`);
    if (stat.size > maxFileBytes) findings.push(`${relative}: ${(stat.size / 1024 / 1024).toFixed(1)} MiB exceeds 5 MiB`);

    const bytes = fs.readFileSync(file);
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf8');
    for (const { label, re } of sensitiveText) {
        if (label === 'a private home path' && intentionalPathFixtures.has(relative)) continue;
        if (re.test(text)) findings.push(`${relative}: ${label}`);
    }
}

for (const finding of findings) console.error(`public-tree: ${finding}`);
if (findings.length) process.exit(1);
console.log('public tree: no private paths, credentials, key files, publishable sidecars or oversized files');
