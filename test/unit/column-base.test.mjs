// `column` is the 0-based machine value; `oneBased` is display-only and must never be forwarded.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, '..', 'fixtures', 'lineage-canary');
const captured = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'A2-query-residue-map.json'), 'utf8')).row;

// What the captured run sent and what the server echoed back:
//   select_msa_columns(entry 1, columns [15, 64, 96, 118])
//   -> residueMapping "15->A12, 64->A56, 96->A86, 118->A108"
const SENT_ZERO_BASED = [15, 64, 96, 118];
const DISPLAY_ONE_BASED = [16, 65, 97, 119];
const ECHOED = { 15: 'A12', 64: 'A56', 96: 'A86', 118: 'A108' };

// The residue an entry occupies at a 0-based alignment column, derived from the captured row alone:
// `occupiedColumns` are inclusive 0-based spans in column order, and `tokens` are that entry's residues
// in the same order. A column outside every span is a gap and occupies no residue.
function residueAt(row, column) {
    let consumed = 0;
    for (const span of row.occupiedColumns) {
        const [from, to] = span.split('-').map(Number);
        if (column >= from && column <= to) return row.tokens[consumed + (column - from)];
        consumed += to - from + 1;
    }
    return null;
}

test('the captured row reproduces the mapping the server echoed, on the 0-based values', () => {
    // Establishes that `residueAt` is the server's own reading before anything is concluded from it.
    for (const column of SENT_ZERO_BASED) {
        assert.equal(residueAt(captured, column), ECHOED[column],
            `column ${column} must map to ${ECHOED[column]}, as select_msa_columns echoed`);
    }
    assert.equal(captured.entryName, 'query');
    assert.equal(captured.totalColumns, 147);
});

test('the 1-based display values name DIFFERENT residues — sending them is a wrong motif, not an error', () => {
    // The whole hazard in one assertion. Every 1-based value is in range, so nothing refuses; the motif
    // it produces is simply not the site that was chosen.
    const wrong = DISPLAY_ONE_BASED.map(column => residueAt(captured, column));
    const right = SENT_ZERO_BASED.map(column => residueAt(captured, column));
    assert.deepEqual(right, ['A12', 'A56', 'A86', 'A108']);
    assert.deepEqual(wrong, ['A13', 'A57', 'A87', 'A109'],
        'each 1-based value lands one residue along, which is exactly the off-by-one');
    for (const [index, column] of DISPLAY_ONE_BASED.entries()) {
        assert.notEqual(wrong[index], right[index],
            `column ${column} must not resolve to the residue column ${SENT_ZERO_BASED[index]} does`);
        assert.notEqual(wrong[index], null,
            'and it is not a gap either — it resolves, which is what makes the mistake silent');
    }
    // Stated as the motif a caller would forward: four real residues, none of them the intended ones.
    assert.notDeepEqual(wrong, right, 'the two bases produce different motifs from one column choice');
});

test('every column of the canary selection is occupied under BOTH bases, so range checks cannot catch it', () => {
    // A range check against `totalColumns` passes for either base, and a gap check passes too. There is
    // no validation the server or the CLI could add that would distinguish them — only the contract can.
    for (const column of [...SENT_ZERO_BASED, ...DISPLAY_ONE_BASED]) {
        assert.ok(column >= 0 && column < captured.totalColumns, `${column} is in range`);
        assert.notEqual(residueAt(captured, column), null, `${column} is not a gap`);
    }
});

test('the shipped tree states the rule where a forwarder and a reader would each look', () => {
    // A contract nobody can find is not a contract. Each of these is a file an agent reads on the path
    // from a candidate table to the server call.
    const shipped = file => fs.readFileSync(path.join(
        HERE, '..', '..', 'plugin', 'skills', file), 'utf8');
    const sites = {
        'references/workflow-state.md': /0-based/,
        'references/analysis-cli.md': /`oneBased`[^.]*display/i,
        'foldmason-motif-forwarding/SKILL.md': /`column`[^.]*never[^.]*`oneBased`|`oneBased`[^.]*never/i,
        'foldmason-conserved-site/SKILL.md': /`oneBased`[^.]*display|display[^.]*`oneBased`/i,
    };
    for (const [file, pattern] of Object.entries(sites)) {
        assert.match(shipped(file), pattern, `${file} does not state the column-base rule`);
    }
});
