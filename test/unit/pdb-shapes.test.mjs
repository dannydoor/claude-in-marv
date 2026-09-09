// The shape-based PDB entry key is checked against a static census sampled from captured rows. The tests
// cover every spelling in that census, including copy suffixes and numeric chains. A newly emitted shape
// becomes visible only when a later capture is censused or added to the fixture.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RULE_ID, normalise, pdbEntryReading } from '../../plugin/analysis/src/workflow/normalise.mjs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAPTURED = path.join(HERE, '..', 'fixtures', 'lineage-canary',
    'pdb100-identifier-shapes.json');
const sampled = JSON.parse(fs.readFileSync(CAPTURED, 'utf8')).databases;
const examplesOf = db => Object.values(sampled[db].shapes).flatMap(shape => shape.examples);

test('the fixture is sampled from the capture and covers every documented shape in it', () => {
    // Guards the guard: if the sample stops carrying the copy suffix or the numeric chain, the tests
    // below would pass by not exercising them.
    const shapes = Object.keys(sampled.pdb100.shapes);
    assert.deepEqual(shapes.sort(), ['-assembly<N>_<CH>', '-assembly<N>_<CH>-<N>', '-assembly<N>_<N>'],
        'pdb100 must still show exactly the three measured shapes');
    assert.equal(sampled.pdb100.rows, 923);
    assert.equal(sampled.pdb100.shapes['-assembly<N>_<CH>-<N>'].rows, 75, 'the copy-suffix rows');
    assert.equal(sampled.pdb100.shapes['-assembly<N>_<N>'].rows, 4, 'the numeric-chain rows');
    assert.deepEqual(Object.keys(sampled.pdb_folddisco.shapes), ['.<CH>']);
    assert.equal(sampled.pdb_folddisco.rows, 1000);
});

test('EVERY sampled pdb100 identifier reduces to its accession, whatever its shape', () => {
    // The class, not the instance: the assertion is over every example the capture holds, so a shape
    // the grammar cannot parse fails here rather than silently keying as its whole self.
    const examples = examplesOf('pdb100');
    assert.ok(examples.length >= 9, 'the sample must carry examples of all three shapes');
    for (const target of examples) {
        const read = pdbEntryReading(target);
        assert.equal(read.isPdb, true, `${target}: not recognised as a PDB identifier`);
        assert.equal(read.unparsed, false, `${target}: ${read.reason}`);
        assert.equal(read.entryLevel, true, `${target}: not reduced to an entry key`);
        assert.match(read.accession, /^[0-9][A-Z0-9]{3}$/, `${target}: accession shape`);
        assert.equal(read.accession, target.slice(0, 4).toUpperCase(), `${target}: accession is the leading four`);
    }
});

test('the copy suffix is parsed and kept as a qualifier, never as part of the key', () => {
    const withCopy = sampled.pdb100.shapes['-assembly<N>_<CH>-<N>'].examples;
    assert.ok(withCopy.length > 0);
    for (const target of withCopy) {
        const read = pdbEntryReading(target);
        assert.equal(read.entryLevel, true, `${target}: still not keyed`);
        assert.equal(typeof read.copy, 'number', `${target}: copy index not parsed`);
        assert.notEqual(read.chain, null, `${target}: the chain before the copy must survive`);
        assert.notEqual(read.assembly, null, `${target}: the assembly must survive`);
        // The key is the accession alone — the copy is a qualifier beside it.
        assert.equal(read.accession.length, 4);
        assert.equal(read.accession.includes('-'), false);
        // The generic normaliser keeps this spelling intact; the PDB entry parser supplies the entry key.
        assert.notEqual(normalise(target).base, read.accession,
            `${target}: the generic base must remain distinct from the PDB entry key`);
    }
});

test('a numeric chain identifier is a chain, not a copy index', () => {
    for (const target of sampled.pdb100.shapes['-assembly<N>_<N>'].examples) {
        const read = pdbEntryReading(target);
        assert.equal(read.entryLevel, true);
        assert.match(read.chain, /^[0-9]+$/, `${target}: the token after the underscore is the chain`);
        assert.equal(read.copy, null, `${target}: and there is no copy index`);
    }
});

test('the motif side reduces to the same accession space, so the two sides can meet', () => {
    for (const target of examplesOf('pdb_folddisco')) {
        const read = pdbEntryReading(target);
        assert.equal(read.entryLevel, true, `${target}: not keyed`);
        assert.equal(read.assembly, null, 'pdb_folddisco names no assembly');
        assert.equal(read.chain, null, 'nor a chain');
        assert.equal(read.copy, null, 'nor a copy');
    }
    // Representative spellings from both sides meet on the accession.
    for (const [fold, motif] of [['1d4z-assembly1_A', '1d4z.ent'], ['1nxx-assembly1_A-2', '1nxx.ent'],
        ['4le2-assembly4_D-2', '4le2.ent']]) {
        assert.equal(pdbEntryReading(fold).accession, pdbEntryReading(motif).accession, `${fold} vs ${motif}`);
    }
});

test('a non-PDB identifier is untouched by the PDB entry grammar', () => {
    for (const db of ['afdb-swissprot', 'afdb-proteome_folddisco']) {
        for (const target of examplesOf(db)) {
            const read = pdbEntryReading(target);
            assert.equal(read.isPdb, false, `${target}: read as a PDB identifier`);
            assert.equal(read.entryLevel, false);
            assert.equal(read.unparsed, false, `${target}: must not be reported as a refused PDB shape`);
            assert.equal(read.base, normalise(target).base, `${target}: keeps the reach-norm-1 base`);
        }
    }
    // And a CATH-style domain id, which leads with four accession-like characters and is not one.
    assert.equal(pdbEntryReading('1abcA01').isPdb, false);
});

test('an undocumented shape is REFUSED and REPORTED, never reduced by stripping', () => {
    // Match the whole documented shape or nothing, so an unseen spelling cannot become a guessed key.
    for (const target of ['1abc-something-odd', '1abc-assembly1_A-2-3', '1abc-assembly1_TOOLONG',
        '1abc.assembly1_A', '1abc-assembly_A', '1abc-1-2']) {
        const read = pdbEntryReading(target);
        assert.equal(read.isPdb, true, `${target}: leads with an accession`);
        assert.equal(read.entryLevel, false, `${target}: must not be keyed`);
        assert.equal(read.unparsed, true, `${target}: must be reported`);
        assert.equal(read.accession, null, `${target}: no accession is claimed from a shape it cannot read`);
        assert.match(read.reason, /matches no documented pdb100 shape/);
    }
    assert.equal(RULE_ID, 'reach-norm-1');
});
