#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [left, right] = process.argv.slice(2).map(file => path.resolve(file));
assert.ok(left && right, 'usage: compare-archive-contents.mjs <archive> <archive>');
assert.ok(fs.statSync(left, { throwIfNoEntry: false })?.isFile(), `archive not found: ${left}`);
assert.ok(fs.statSync(right, { throwIfNoEntry: false })?.isFile(), `archive not found: ${right}`);

const members = archive => execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .sort();

const expected = members(left);
const actual = members(right);
assert.ok(expected.length > 0, `${left} is empty`);
assert.deepEqual(actual, expected, 'archive member lists differ');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-contents-'));
try {
    const leftRoot = path.join(temporary, 'left');
    const rightRoot = path.join(temporary, 'right');
    fs.mkdirSync(leftRoot);
    fs.mkdirSync(rightRoot);
    execFileSync('unzip', ['-q', left, '-d', leftRoot], { stdio: 'inherit' });
    execFileSync('unzip', ['-q', right, '-d', rightRoot], { stdio: 'inherit' });

    for (const member of expected) {
        assert.deepEqual(
            fs.readFileSync(path.join(leftRoot, member)),
            fs.readFileSync(path.join(rightRoot, member)),
            `archive member differs: ${member}`,
        );
    }
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}

console.log(`${path.basename(left)} and ${path.basename(right)} contain the same ${expected.length} files`);
