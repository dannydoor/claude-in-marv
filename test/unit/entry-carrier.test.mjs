// PDB entry carriers keep assembly and chain as qualifiers and never overstate finer agreement.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    RULE_ID, entryLevelEligible, pdbEntryReading, normalise, readings,
} from '../../plugin/analysis/src/workflow/normalise.mjs';
import { intersectCollection } from '../../plugin/analysis/src/workflow/reach.mjs';

// A carrier as `carriersOf` builds one, so the intersection is exercised on the real shape.
const carrier = (base, { matchLevel = 'entry', originals = [], chains = [], assemblies = [] } = {}) => ({
    base,
    collection: 'pdb',
    matchLevel,
    originals: new Set(originals.length > 0 ? originals : [base]),
    chains: new Set(chains),
    assemblies: new Set(assemblies),
    wholeKeys: new Set(matchLevel === 'entry' ? [] : [base]),
    stripped: new Set(),
    databases: new Set(['pdb100']),
    rows: 1,
    best: 1,
    nodes: null,
    rmsd: null,
});

const intersectOne = (leftCarrier, rightCarrier) => {
    const rows = [];
    const totals = { exact: 0, normalised: 0, ambiguous: 0, both: 0, foldOnly: 0, motifOnly: 0 };
    intersectCollection({
        collection: 'pdb',
        left: new Map([[leftCarrier.base, leftCarrier]]),
        right: new Map([[rightCarrier.base, rightCarrier]]),
        comparable: true,
        rows,
        totals,
    });
    return { rows, totals, matched: rows.find(row => row.kind === 'exact' || row.kind === 'normalised') };
};

test('the observed case: 1d4z-assembly1_A and 1d4z.ent are one entry carrier', () => {
    // The exact pair the canary produced, and the reason this rule exists.
    const fold = pdbEntryReading('1d4z-assembly1_A');
    const motif = pdbEntryReading('1d4z.ent');
    assert.equal(fold.entryLevel, true);
    assert.equal(motif.entryLevel, true);
    assert.equal(fold.accession, '1D4Z');
    assert.equal(motif.accession, '1D4Z');
    assert.equal(fold.accession, motif.accession, 'the match key is the four-character accession');
    // And the qualifiers survive rather than being discarded to get there.
    assert.equal(fold.assembly, 1);
    assert.equal(fold.chain, 'A');
    assert.equal(motif.assembly, null);
    assert.equal(motif.chain, null);
    // The bases `reach-norm-1` produced, which is what did not match and is why the fix was needed.
    assert.equal(fold.base, '1D4Z-ASSEMBLY1');
    assert.equal(motif.base, '1D4Z');
    assert.notEqual(fold.base, motif.base);
    // End to end through the intersection: one `both`, and it is entry-level and assembly-agnostic.
    const { totals, matched } = intersectOne(
        carrier('1D4Z', { originals: ['1d4z-assembly1_A'], chains: ['A'], assemblies: [1] }),
        carrier('1D4Z', { originals: ['1d4z.ent'] }),
    );
    assert.equal(totals.both, 1);
    assert.equal(matched.matchLevel, 'entry');
    assert.equal(matched.assemblyAgreement, 'assembly-agnostic');
    assert.equal(matched.chainAgreement, 'chain-agnostic');
});

test('assembly ABSENT on one side is assembly-agnostic, never agreed', () => {
    const { totals, matched } = intersectOne(
        carrier('2FLK', { assemblies: [1], chains: ['A'] }),
        carrier('2FLK'),
    );
    assert.equal(totals.both, 1, 'the entry-level match still stands');
    assert.equal(matched.assemblyAgreement, 'assembly-agnostic');
    assert.deepEqual(matched.foldAssemblies, [1]);
    assert.deepEqual(matched.motifAssemblies, []);
});

test('assembly MATCHING on both sides is the only case that claims agreement', () => {
    const { totals, matched } = intersectOne(
        carrier('3CHY', { assemblies: [1], chains: ['A'] }),
        carrier('3CHY', { assemblies: [1], chains: ['A'] }),
    );
    assert.equal(totals.both, 1);
    assert.equal(matched.assemblyAgreement, 'assembly-agreed');
    assert.equal(matched.chainAgreement, 'chain-agreed', 'and both sides naming chain A agree on it');
});

test('assembly DIFFERING is assembly-agnostic too, and there is no mismatch label', () => {
    // Different assemblies of one entry are NOT the same structure — they may be different quaternary
    // arrangements — so a difference is never read as sameness. What must survive is only the narrower
    // claim: both rows reach the same PDB-ENTRY carrier. The assembly claim is WITHHELD rather than
    // contradicted, which is why the label is agnostic and there is no mismatch label; the per-side
    // assembly columns below keep *silent* distinguishable from *differing*.
    const { totals, matched } = intersectOne(
        carrier('1M5T', { assemblies: [1] }),
        carrier('1M5T', { assemblies: [2] }),
    );
    assert.equal(totals.both, 1, 'a differing assembly does not withdraw the entry-level match');
    assert.equal(matched.assemblyAgreement, 'assembly-agnostic');
    assert.notEqual(matched.assemblyAgreement, 'assembly-agreed');
    assert.deepEqual(matched.foldAssemblies, [1]);
    assert.deepEqual(matched.motifAssemblies, [2]);
});

test('chain identifiers are PRESERVED on the carrier and never folded into the key', () => {
    // Preserved, case-significant, and reported per side — the key is the accession alone.
    for (const [target, accession, chain] of [
        ['1abc_A', '1ABC', 'A'],
        ['1abc_a', '1ABC', 'a'],
        ['3t6k-assembly2_B', '3T6K', 'B'],
        ['2r25-assembly1_D', '2R25', 'D'],
        ['1d4z.ent', '1D4Z', null],
    ]) {
        const read = pdbEntryReading(target);
        assert.equal(read.accession, accession, `${target}: accession`);
        assert.equal(read.chain, chain, `${target}: chain`);
    }
    assert.notEqual(pdbEntryReading('1abc_a').chain, pdbEntryReading('1abc_A').chain, 'a chain is case-significant');
    // Two chains of one entry reach the intersection as one carrier carrying both chains, and a chain
    // claim is still refused against a side that names none.
    const { totals, matched } = intersectOne(
        carrier('1VLZ', { chains: ['A', 'B'], assemblies: [1] }),
        carrier('1VLZ'),
    );
    assert.equal(totals.both, 1);
    assert.deepEqual(matched.foldChains, ['A', 'B']);
    assert.deepEqual(matched.motifChains, []);
    assert.equal(matched.chainAgreement, 'chain-agnostic', 'one side naming no chain claims no chain');
    // Both naming chains that do not meet is a mismatch, and it stays one: the entry matched, the chain
    // did not, and the row says so rather than quietly agreeing.
    const differing = intersectOne(
        carrier('1EHC', { chains: ['A'], assemblies: [1] }),
        carrier('1EHC', { chains: ['B'], assemblies: [1] }),
    );
    assert.equal(differing.totals.both, 1);
    assert.equal(differing.matched.chainAgreement, 'chain-mismatch');
    assert.equal(differing.matched.assemblyAgreement, 'assembly-agreed', 'the assembly still agrees');
});

test('the entry-level key is monomer-only, and the exclusion is reported rather than inferred', () => {
    assert.deepEqual(entryLevelEligible({ foldTool: 'foldseek', motifTool: 'folddisco' }),
        { eligible: true, reason: null });
    // A multimer fold side is the case the weakening must not touch: there the chain and the assembly
    // ARE the subject of the claim, not a qualifier of it.
    const multimer = entryLevelEligible({ foldTool: 'multimer', motifTool: 'folddisco' });
    assert.equal(multimer.eligible, false);
    assert.match(multimer.reason, /monomer-only/);
    assert.match(multimer.reason, /multimer, an interface or any cross-chain claim/);
    // And a motif side that is not a motif search.
    assert.equal(entryLevelEligible({ foldTool: 'foldseek', motifTool: 'foldmason' }).eligible, false);
    assert.equal(entryLevelEligible({ foldTool: undefined, motifTool: undefined }).eligible, false);
});

test('reach-norm-1 keeps non-PDB carriers on their normalised structure key', () => {
    assert.equal(RULE_ID, 'reach-norm-1');
    assert.equal(normalise('1d4z-assembly1_A').base, '1D4Z-ASSEMBLY1');
    assert.equal(normalise('1d4z-assembly1_A').chain, 'A');
    assert.equal(readings('1d4z-assembly1_A').split.base, '1D4Z-ASSEMBLY1');
    assert.equal(readings('1d4z.ent').split.base, '1D4Z');
    // An identifier the PDB shape does not match keeps the general normalised key.
    for (const target of ['AF-Q9I4N3-F1-model_v4.pdb', 'MGYP000879415706', 'A0A481Z7D4', '1abcA01']) {
        const read = pdbEntryReading(target);
        assert.equal(read.entryLevel, false, `${target} must not be read as a PDB accession`);
        assert.equal(read.accession, null);
        assert.equal(read.base, normalise(target).base, `${target}: the reach-norm-1 base is unchanged`);
    }
});
