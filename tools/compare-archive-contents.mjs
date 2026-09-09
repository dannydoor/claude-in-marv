#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
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

for (const member of expected) {
    assert.deepEqual(
        execFileSync('unzip', ['-p', left, member]),
        execFileSync('unzip', ['-p', right, member]),
        `archive member differs: ${member}`,
    );
}

console.log(`${path.basename(left)} and ${path.basename(right)} contain the same ${expected.length} files`);
