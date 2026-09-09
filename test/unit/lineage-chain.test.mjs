// Explicit lineage-chain resolution over captured canary manifests.
//
// These three manifests are what the live server wrote (`test/fixtures/lineage-canary/SOURCE.md`).
// Nothing here is authored, and that matters more than usual: the thing under test is a provenance
// resolver, so a hand-written manifest would assume the very ancestry it is supposed to establish.
//
// The observation these gate: A3's `derivedFrom` names A2's ticket and carries NO `queryIdx`, so one hop
// resolves the motif side to A2 while the fold side is its own origin A1 — two different origins on a
// pair that really is one query. The chain rule walks A3 -> A2 -> A1 and reaches the exact
// `(ticket, queryIdx)`; every refusal below is a case where it must not.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    CHAIN_RULE, hopOf, intermediatePool, originOf, queryEntryOf, resolveChain, sameOrigin,
} from '../../plugin/analysis/src/workflow/origin.mjs';

import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const CAPTURED = path.join(ROOT, 'test', 'fixtures', 'lineage-canary');
const captured = name => JSON.parse(fs.readFileSync(path.join(CAPTURED, `${name}.manifest.json`), 'utf8'));

const A1 = captured('A1-foldseek');
const A2 = captured('A2-foldmason');
const A3 = captured('A3-folddisco');

const T1 = 'fUixtokkLHJiCeKaGzQOjdOOaSmYpBbYr0i7bw';
const T2 = '96CMmZMi1tlT1lea8KI5yhG4jdyPdnoDZjFAwg';
const T3 = 'Sw7hyL7dIPUeVjCzRcZbJhDvfWOZ_VhmFunLow';

const entry = manifest => ({ artifactId: manifest.artifactId, manifest });
const poolOf = (...manifests) => {
    const pool = intermediatePool(manifests.map(entry));
    assert.deepEqual(pool.clashes, [], 'this pool was meant to be unambiguous');
    return pool;
};

test('the captured manifests are the observation, and the fixture is not quietly authored', () => {
    // If any of these drifts, the fixture stopped being the canary's and every test below means
    // something else. Checked first, so a doctored fixture fails here rather than passing downstream.
    assert.equal(A1.state.ticket, T1);
    assert.equal(A2.state.ticket, T2);
    assert.equal(A3.state.ticket, T3);
    assert.equal(A1.derivedFrom, null, 'A1 is a direct submission');
    assert.equal(A2.derivedFrom.ticket, T1);
    assert.equal(A2.derivedFrom.queryIdx, 0, 'A2 carries a complete one-hop origin');
    assert.equal(A3.derivedFrom.ticket, T2, 'A3 names the FoldMason ticket, not the search ticket');
    assert.equal(Object.hasOwn(A3.derivedFrom, 'queryIdx'), false, 'and it carries no query index at all');
    assert.equal(A3.derivedFrom.origin, 'fm-entry');
    assert.equal(A3.derivedFrom.entryName, 'query');
    assert.ok(A2.derivedFrom.entries.includes('query.cif'), 'the forwarded query is in A2 roster');
});

test('one hop still answers where a manifest carries a complete pair, and refuses where it does not', () => {
    // Unchanged `derivedFrom-ancestry` behaviour, asserted so the chain rule cannot be read as replacing
    // it: A1 and A2 both resolve on their own, and only A3 needs anything further.
    assert.deepEqual(originOf(A1), { ticket: T1, queryIdx: 0, via: 'direct-submission', resolved: true });
    assert.deepEqual(originOf(A2), { ticket: T1, queryIdx: 0, via: 'derivedFrom', resolved: true });
    assert.equal(originOf(A3).resolved, false, 'a ticket without a query index is not an origin');
    assert.equal(originOf(A3).ticket, null, 'and it does not half-resolve to the parent ticket');
    // The disagreement the chain exists to settle, stated as one hop sees it.
    assert.equal(sameOrigin(originOf(A1), originOf(A3)), false);
});

test('a hop is classified by what its own manifest records, and the three shapes are told apart', () => {
    assert.equal(hopOf(A1).kind, 'direct');
    assert.equal(hopOf(A2).kind, 'complete');
    const partial = hopOf(A3);
    assert.equal(partial.kind, 'partial');
    assert.equal(partial.ticket, T2);
    assert.equal(partial.origin, 'fm-entry');
    assert.equal(partial.entryName, 'query');
    // Shapes that are not ancestry at all, and are never read as an origin.
    assert.equal(hopOf({ derivedFrom: [] }).kind, 'unreadable');
    assert.equal(hopOf({ derivedFrom: { queryIdx: 0 } }).kind, 'unreadable');
    assert.equal(hopOf({ state: { ticket: '' } }).kind, 'unreadable');
});

test('the chain resolves A3 -> A2 -> A1 to the exact (ticket, queryIdx), and to the same origin as the fold side', () => {
    const walked = resolveChain(A3, poolOf(A2));
    assert.equal(walked.resolved, true);
    assert.equal(walked.origin.ticket, T1, 'the origin is the SEARCH ticket, two hops up');
    assert.equal(walked.origin.queryIdx, 0, 'and the exact query index, which A3 never carried');
    assert.equal(walked.hops, 2, 'A3 then A2: two hops');
    assert.deepEqual(walked.consumed, [A2.artifactId], 'exactly the intermediate that was needed');
    assert.deepEqual(walked.route.map(step => step.ticket), [T3, T2]);
    assert.equal(walked.route[0].inheritedFrom, T2);
    // The whole point: the two sides now agree, from recorded ancestry and nothing asserted.
    assert.equal(sameOrigin(originOf(A1), walked.origin), true);
});

test('a chain is a MATCH against the supplied intermediate, never a lookup', () => {
    // The hop's `derivedFrom.ticket` must equal the intermediate's own `state.ticket`. A1 is a real
    // artifact of the same chain and still does not match A3's hop, which names A2.
    const missing = resolveChain(A3, poolOf(A1));
    assert.equal(missing.resolved, false);
    assert.equal(missing.problem.kind, 'missing');
    assert.equal(missing.problem.ticket, T2, 'the refusal names the ticket to supply');
    assert.equal(missing.problem.origin, 'fm-entry');
    // And with nothing supplied at all, which is the default state of any run.
    const empty = resolveChain(A3, poolOf());
    assert.equal(empty.resolved, false);
    assert.equal(empty.problem.kind, 'missing');
    assert.equal(empty.problem.ticket, T2);
});

test('two intermediates claiming one ticket are ambiguous, and nothing chooses between them', () => {
    const clash = intermediatePool([
        entry(A2),
        { artifactId: 'f'.repeat(64), manifest: { ...A2, artifactId: 'f'.repeat(64) } },
    ]);
    assert.equal(clash.clashes.length, 1);
    assert.equal(clash.clashes[0].reason, 'two intermediates name one ticket');
    assert.equal(clash.clashes[0].ticket, T2);
    assert.deepEqual(clash.clashes[0].artifactIds, [A2.artifactId, 'f'.repeat(64)].sort());
    // An intermediate that is not an artifact of a ticket cannot be a link either.
    const nameless = intermediatePool([{ artifactId: 'x', manifest: { state: {} } }]);
    assert.equal(nameless.clashes[0].reason, 'this intermediate carries no state ticket');
    assert.equal(nameless.byTicket.size, 0);
});

test('a cyclic chain refuses instead of walking forever', () => {
    // A manifest whose ancestry points at itself. Constructed deliberately — a cycle is exactly what the
    // server does not produce, so the only way to gate the guard is to build one.
    // Every other guard is made to PASS here, so what stops the walk is the cycle and nothing else:
    // each link is a FoldMason artifact whose roster carries the forwarded query.
    const link = (id, ticket, parent) => ({
        artifactId: id.repeat(64),
        state: { ticket, tool: 'foldmason' },
        derivedFrom: { ticket: parent, origin: 'fm-entry', entryName: 'query', entries: ['query.cif'] },
    });
    const loop = link('a', 'LOOP', 'LOOP');
    const walked = resolveChain(loop, poolOf(loop));
    assert.equal(walked.resolved, false);
    assert.equal(walked.problem.kind, 'cyclic');
    assert.equal(walked.problem.ticket, 'LOOP');
    // A two-step cycle, so the guard is not merely catching self-reference.
    const a = link('b', 'A', 'B');
    const b = link('c', 'B', 'A');
    const pair = resolveChain(a, poolOf(a, b));
    assert.equal(pair.resolved, false);
    assert.equal(pair.problem.kind, 'cyclic');
});

test('an fm-entry inherits an origin only when its entry IS the alignment query entry', () => {
    // A motif read from an alignment hit must not inherit the query entry's origin.
    const offAHit = { ...A3, derivedFrom: { ...A3.derivedFrom, entryName: '3gt7-assembly1', entry: 3 } };
    const walked = resolveChain(offAHit, poolOf(A2));
    assert.equal(walked.resolved, false);
    assert.equal(walked.problem.kind, 'unidentified-entry');
    assert.equal(walked.problem.entryName, '3gt7-assembly1');
    assert.equal(walked.problem.queryEntry, 'query');
    // `3gt7-assembly1` really is in A2's roster, so this is not a "not in the alignment" refusal — it is
    // in the alignment and is not the query.
    assert.ok(A2.derivedFrom.entries.includes('3gt7-assembly1.pdb'));
    // An fm-entry that names no entry at all cannot be shown to be the query either.
    const unnamed = { ...A3, derivedFrom: { ...A3.derivedFrom, entryName: undefined } };
    assert.equal(resolveChain(unnamed, poolOf(A2)).problem.kind, 'unidentified-entry');
});

test('the query entry is read off the intermediate own roster, and its absence refuses', () => {
    assert.deepEqual(queryEntryOf(A2), { name: 'query', reason: null });
    // `includeQuery: false`: an alignment of hits alone. There is no query entry, so there is no origin
    // for a motif read off it to inherit — a real forwarding option, not a hypothetical.
    const hitsOnly = { ...A2, derivedFrom: { ...A2.derivedFrom, entries: ['3gt7-assembly1.pdb', '2r25-assembly1.pdb'] } };
    assert.equal(queryEntryOf(hitsOnly).name, null);
    assert.equal(queryEntryOf(hitsOnly).reason, 'the intermediate carries no forwarded query entry');
    const walked = resolveChain(A3, poolOf(hitsOnly));
    assert.equal(walked.resolved, false);
    assert.equal(walked.problem.kind, 'unidentified-entry');
    // Two roster files that could both be the query entry: ambiguous, and it refuses rather than taking
    // the first. `query.cif` and a hit a depositor happened to call `query.pdb` are indistinguishable
    // here, and the entry INDEX cannot break the tie because no manifest states the entry order.
    const twoQueries = { ...A2, derivedFrom: { ...A2.derivedFrom, entries: ['query.cif', 'query.pdb'] } };
    assert.equal(queryEntryOf(twoQueries).name, null);
    assert.equal(queryEntryOf(twoQueries).reason, 'more than one roster file could be the query entry');
    assert.deepEqual(queryEntryOf(twoQueries).candidates, ['query.cif', 'query.pdb']);
    // No roster at all — a direct submission is not an intermediate of an fm-entry hop.
    assert.equal(queryEntryOf(A1).name, null);
    assert.equal(queryEntryOf(A1).reason, 'the intermediate records no entry roster');
});

test('an fm-entry hop whose intermediate is not a FoldMason artifact is a mismatch', () => {
    // The hop says the motif came off an alignment entry. An intermediate that is not an alignment
    // cannot have had that entry, whatever its ticket says.
    const notAnAlignment = { ...A2, state: { ...A2.state, tool: 'foldseek' } };
    const walked = resolveChain(A3, poolOf(notAnAlignment));
    assert.equal(walked.resolved, false);
    assert.equal(walked.problem.kind, 'mismatched');
    assert.equal(walked.problem.expectedTool, 'foldmason');
    assert.equal(walked.problem.tool, 'foldseek');
});

test('the runtime names the explicit recorded-ancestry chain', () => {
    assert.equal(CHAIN_RULE, 'derivedFrom-chain');
});

test('nothing in the resolver reaches a network or discovers a root of its own', () => {
    // A structural claim, so it is checked structurally: the module that walks ancestry imports no
    // filesystem or network module and names no discovery call. It is handed manifests and reads them.
    const source = fs.readFileSync(
        path.join(ROOT, 'plugin', 'analysis', 'src', 'workflow', 'origin.mjs'), 'utf8');
    for (const forbidden of ['node:fs', 'node:https', 'node:http', 'node:net', 'readdirSync',
        'readFileSync', 'fetch(', 'globSync', 'existsSync']) {
        assert.equal(source.includes(forbidden), false, `origin.mjs must not name ${forbidden}`);
    }
    assert.equal(/^import\s/m.test(source), false, 'origin.mjs imports nothing at all');
});
