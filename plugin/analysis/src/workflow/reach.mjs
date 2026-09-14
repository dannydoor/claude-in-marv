// Intersect fold and motif carriers only after confirming an exact shared query origin.

import fs from 'node:fs';
import { saturation } from '../protocol/results.mjs';
import { better, forEachRow, round, usableDirection } from '../hit/rows.mjs';
import { popcount } from '../folddisco/motif.mjs';
import {
    entryLevelEligible, pdbEntryReading, readings, RULE_ID,
} from './normalise.mjs';
import {
    CHAIN_RULE, DB_ASSERTION, ORIGIN_ASSERTION, intermediatePool, originOf,
    parseAssertion, resolveChain, sameOrigin,
} from './origin.mjs';
import { refuse, repeatedValues } from '../cli/args.mjs';

// Bound carrier allocations from both artifacts.
const BOUND = Object.freeze({ carriers: 1000000 });

// How many refused identifiers the report lists inline.
const UNPARSED_SAMPLE = 10;

// Fixed collection equivalences used by reach analysis version 1.
const REACH_DATA = JSON.parse(fs.readFileSync(new URL('../../data/reach-v1.json', import.meta.url), 'utf8'));
const COLLECTION_MAP = Object.freeze({ ...REACH_DATA.collectionMap });
const COLLECTION_MAP_VERSION = REACH_DATA.collectionMapVersion;

export const reach = {
    name: 'workflow/reach',
    version: REACH_DATA.analysisVersion,
    roles: ['rows'],
    options: ['against', 'assert', 'via'],
    against: true,

    async run(context) {
        const collectionMap = COLLECTION_MAP;
        const collectionMapVersion = COLLECTION_MAP_VERSION;

        const assertions = readAssertions(context);
        const origin = resolveOrigin(context, assertions);

        const fold = { ...context, side: 'fold' };
        const motif = context.against;

        // Use entry-level keys only for the monomer pairing.
        const eligibility = entryLevelEligible({ foldTool: context.tool, motifTool: motif.tool });
        const entryLevel = eligibility.eligible;
        const matchRule = {
            id: RULE_ID,
            entryLevel,
            keyedBy: entryLevel ? 'four-character PDB accession, with assembly, chain and copy as qualifiers'
                : 'normalised identifier base, assembly and chain folded into the key',
            scope: 'a monomer foldseek fold side against a folddisco motif side',
            withheld: !eligibility.eligible ? eligibility.reason : null,
        };
        for (const [label, side] of [['fold', fold], ['motif', motif]]) {
            const sat = saturation({ completeness: side.completeness, tool: side.tool });
            if (sat.saturated) {
                context.warnings.add('SATURATED_ROWS', {
                    scope: { side: label }, facts: { rowCap: sat.rowCap, basis: sat.basis },
                });
            }
        }

        const joins = equivalenceJoins(assertions);
        const foldSide = await carriersOf(context, fold, { collectionMap, joins, label: 'fold', entryLevel });
        const motifSide = await carriersOf(context, motif, { collectionMap, joins, label: 'motif', entryLevel });

        // Report every identifier excluded by the grammar.
        matchRule.keyedCarriers = {
            fold: keyLevels(foldSide), motif: keyLevels(motifSide),
        };
        matchRule.unparsed = {
            count: foldSide.unparsed.count + motifSide.unparsed.count,
            fold: foldSide.unparsed, motif: motifSide.unparsed,
        };
        if (matchRule.unparsed.count > 0) {
            context.warnings.add('INTEGRITY_ISSUE', {
                facts: {
                    reason: 'an identifier led with a PDB accession and matched no documented pdb100 shape, so it was not reduced to an entry key',
                    rule: RULE_ID,
                    count: matchRule.unparsed.count,
                    fold: foldSide.unparsed.sample,
                    motif: motifSide.unparsed.sample,
                },
            });
        }

        const shared = [...foldSide.collections.keys()].filter(id => motifSide.collections.has(id)).sort();
        if (shared.length === 0) {
            context.warnings.add('NO_COMMON_DATABASE', {
                facts: {
                    fold: [...foldSide.collections.keys()].sort(),
                    motif: [...motifSide.collections.keys()].sort(),
                    collectionMapVersion,
                },
            });
        }

        const rows = [];
        const totals = { exact: 0, normalised: 0, ambiguous: 0, both: 0, foldOnly: 0, motifOnly: 0 };
        for (const collection of [...new Set([...foldSide.collections.keys(), ...motifSide.collections.keys()])].sort()) {
            intersectCollection({
                collection,
                left: foldSide.collections.get(collection) ?? new Map(),
                right: motifSide.collections.get(collection) ?? new Map(),
                comparable: shared.includes(collection),
                rows,
                totals,
            });
        }
        rows.sort((a, b) => (a.collection < b.collection ? -1 : a.collection > b.collection ? 1
            : (a.base < b.base ? -1 : a.base > b.base ? 1 : 0)));

        // Record every accepted assertion in normalized form.
        context.selectors = {
            against: { artifactId: motif.manifest.artifactId, ticket: motif.manifest.state?.ticket ?? null },
            assertions: assertions.map(entry => entry.normalised),
            // Identify intermediates by artifact id and ticket.
            via: (context.via ?? [])
                .map(entry => ({ artifactId: entry.artifactId, ticket: entry.manifest.state?.ticket ?? null }))
                .sort((a, b) => (a.artifactId < b.artifactId ? -1 : a.artifactId > b.artifactId ? 1 : 0)),
        };

        // Qualifications are counted only for matched rows.
        const qualifications = { assemblyAgreed: 0, assemblyAgnostic: 0, chainAgreed: 0, chainAgnostic: 0, chainMismatch: 0 };
        for (const entry of rows) {
            if (entry.kind !== 'exact' && entry.kind !== 'normalised') continue;
            if (entry.assemblyAgreement === 'assembly-agreed') qualifications.assemblyAgreed += 1;
            if (entry.assemblyAgreement === 'assembly-agnostic') qualifications.assemblyAgnostic += 1;
            if (entry.chainAgreement === 'chain-agreed') qualifications.chainAgreed += 1;
            if (entry.chainAgreement === 'chain-agnostic') qualifications.chainAgnostic += 1;
            if (entry.chainAgreement === 'chain-mismatch') qualifications.chainMismatch += 1;
        }

        const summary = {
            queryOrigin: origin,
            normalisationRule: RULE_ID,
            matchRule,
            qualifications,
            collectionMapVersion,
            sides: {
                fold: sideReport(foldSide, context.manifest),
                motif: sideReport(motifSide, motif.manifest),
            },
            comparablePairs: pairReport(foldSide, motifSide, shared),
            excludedPairs: excludedReport(foldSide, motifSide, shared),
            exact: totals.exact,
            normalised: totals.normalised,
            ambiguous: totals.ambiguous,
            both: totals.both,
            foldOnly: totals.foldOnly,
            motifOnly: totals.motifOnly,
            completeness: { fold: context.completeness, motif: motif.completeness },
        };
        return { summary, tables: { intersection: intersectionTable(rows) } };
    },
};

// Missing comparison evidence is a caller-correctable usage error.
export function resolveOrigin(context, assertions) {
    const supplied = context.via ?? [];
    const pool = intermediatePool(supplied);
    if (pool.clashes.length > 0) {
        refuse('the supplied chain is ambiguous', { rule: CHAIN_RULE, problems: pool.clashes });
    }

    const sessionAssertion = assertions.find(entry =>
        entry.type === ORIGIN_ASSERTION && entry.parsed.mode === 'session') ?? null;

    // A complete manifest resolves without consulting intermediates.
    const walk = manifest => {
        const one = originOf(manifest);
        if (one.resolved) return { resolved: true, origin: one, hops: 1, route: null, consumed: [] };
        return resolveChain(manifest, pool, { sessionAssertion: sessionAssertion !== null });
    };
    const foldWalk = walk(context.manifest);
    const motifWalk = walk(context.against.manifest);
    const left = foldWalk.resolved ? foldWalk.origin : originOf(context.manifest);
    const right = motifWalk.resolved ? motifWalk.origin : originOf(context.against.manifest);

    // Explicit means every link is load-bearing.
    const consumed = new Set([...foldWalk.consumed ?? [], ...motifWalk.consumed ?? []]);
    const unused = supplied.filter(entry => !consumed.has(entry.artifactId)).map(entry => entry.artifactId);
    if (unused.length > 0) {
        refuse('an intermediate was supplied that no hop of either side consumed', {
            rule: CHAIN_RULE, unused, consumed: [...consumed].sort(),
        });
    }

    if (sameOrigin(left, right)) {
        const sessionAssertedEntries = [
            ...(foldWalk.sessionAssertedEntries ?? []),
            ...(motifWalk.sessionAssertedEntries ?? []),
        ];
        const usedSessionAssertion = sessionAssertedEntries.length > 0;
        // The basis records evidence type, not hop count.
        return {
            basis: usedSessionAssertion ? 'session-asserted' : 'derivedFrom-ancestry',
            rule: CHAIN_RULE,
            left,
            right,
            asserted: usedSessionAssertion ? {
                mode: 'session',
                fact: 'the agent states that it submitted both sides in this continuous session',
                origin: { ticket: left.ticket, queryIdx: left.queryIdx },
                queryEntries: sessionAssertedEntries,
            } : null,
            chain: {
                hops: { fold: foldWalk.hops ?? 1, motif: motifWalk.hops ?? 1 },
                route: { fold: foldWalk.route ?? null, motif: motifWalk.route ?? null },
                via: [...consumed].sort(),
            },
        };
    }
    const asserted = assertions.find(entry =>
        entry.type === ORIGIN_ASSERTION && entry.parsed.mode === 'explicit') ?? null;
    if (asserted !== null) {
        return {
            basis: 'user-asserted',
            rule: CHAIN_RULE,
            left,
            right,
            asserted: { left: asserted.parsed.left, right: asserted.parsed.right },
            chain: null,
        };
    }
    refuse('the two artifacts cannot be shown to be the same query', {
        rule: CHAIN_RULE,
        fold: { artifactId: context.manifest.artifactId, origin: left, chain: foldWalk.problem ?? null },
        motif: { artifactId: context.against.manifest.artifactId, origin: right, chain: motifWalk.problem ?? null },
        licence: [
            '--via <artifact-root> for each intermediate of the recorded chain',
            '--assert origin:session only when this agent submitted both sides in the current continuous session and recorded ancestry already converges',
            '--assert origin:left=<ticket>/<queryIdx>,right=<ticket>/<queryIdx>, both pairs complete and naming one origin',
        ],
    });
    return null;
}

function readAssertions(context) {
    const given = repeatedValues(context.args, 'assert');
    const accepted = [];
    for (const raw of given) {
        const parsed = parseAssertion(raw);
        if (parsed.type === null || !parsed.valid) {
            refuse('that assertion is not one this run can accept', {
                assertion: raw,
                reason: parsed.reason ?? 'unknown assertion type',
                accepted: [
                    'origin:session',
                    'origin:left=<ticket>/<queryIdx>,right=<ticket>/<queryIdx>',
                    'db-equivalence:<left-db-path>=<right-db-path>',
                ],
            });
        }
        accepted.push({
            type: parsed.type,
            parsed,
            normalised: parsed.mode === 'session'
                ? { type: parsed.type, mode: parsed.mode }
                : { type: parsed.type, left: parsed.left, right: parsed.right },
        });
    }
    return accepted;
}

// Unmapped database pairs require and record an explicit equivalence assertion.
const equivalenceJoins = assertions => {
    const joins = new Map();
    for (const entry of assertions) {
        if (entry.type !== DB_ASSERTION) continue;
        joins.set(entry.parsed.right, entry.parsed.left);
    }
    return joins;
};

// Carriers, not rows.
export async function carriersOf(context, side, {
    collectionMap, joins, label, entryLevel = false,
} = {}) {
    const direction = side.manifest?.ranking?.direction ?? null;
    const field = side.manifest?.ranking?.field ?? null;
    // A ranking with no usable direction is no ranking.
    const ranked = field !== null && usableDirection(direction);
    if (field !== null && !ranked) {
        context.warnings.add('INTEGRITY_ISSUE', {
            scope: { side: label },
            facts: { field, direction: direction ?? null, reason: 'no usable ranking direction, so no best value is reported' },
        });
    }
    const collections = new Map();
    const databases = [];
    let rowsRead = 0;
    // Identifiers this grammar refused to key.
    const unkeyed = new Set();

    const units = new Map(side.roles.rows.units.map(unit => [unit.dbIndex, unit]));
    for (const dbIndex of side.selected) {
        const record = side.records.get(dbIndex);
        const id = record?.id ?? null;
        const joined = joins.get(id) ?? id;
        const collection = collectionMap[joined] ?? joined;
        databases.push({
            dbIndex,
            id,
            version: record?.version ?? null,
            collection,
            licensedBy: joins.has(id) ? 'assertion' : 'collectionMap',
            parsedRows: record?.parsedRows ?? 0,
        });
        if (!collections.has(collection)) collections.set(collection, new Map());
        const carriers = collections.get(collection);

        await forEachRow(side.root, units.get(dbIndex) ?? { path: null }, row => {
            rowsRead += 1;
            const target = typeof row.target === 'string' ? row.target : null;
            if (target === null || target === '') return;
            // Derive a missing node count from the row's motif pattern.
            const nodecount = Number.isInteger(row.nodecount)
                ? row.nodecount
                : (typeof row.motifPattern === 'string' ? popcount(row.motifPattern) : null);
            const read = readings(target);
            if (read.split.base === '') return;
            // Use entry keys only for documented PDB identifiers.
            const entry = entryLevel ? pdbEntryReading(target) : null;
            const keyedByEntry = entry !== null && entry.entryLevel;
            if (entry !== null && entry.unparsed === true) unkeyed.add(entry.original);
            const key = keyedByEntry ? entry.accession : read.split.base;
            if (key === '') return;
            if (!carriers.has(key) && carriers.size >= BOUND.carriers) return;
            if (!carriers.has(key)) {
                carriers.set(key, {
                    base: key,
                    collection,
                    matchLevel: keyedByEntry ? 'entry' : 'structure',
                    originals: new Set(),
                    chains: new Set(),
                    assemblies: new Set(),
                    copies: new Set(),
                    wholeKeys: new Set(),
                    stripped: new Set(),
                    databases: new Set(),
                    rows: 0,
                    best: null,
                    nodes: null,
                    rmsd: null,
                });
            }
            const carrier = carriers.get(key);
            carrier.originals.add(read.split.original);
            // Entry keys are unambiguous; structure keys retain alternate readings.
            if (!keyedByEntry) carrier.wholeKeys.add(read.whole.base);
            const chain = keyedByEntry ? entry.chain : read.split.chain;
            if (chain !== null) carrier.chains.add(chain);
            if (keyedByEntry && entry.assembly !== null) carrier.assemblies.add(entry.assembly);
            // Preserve qualifiers so absence cannot imply agreement.
            if (keyedByEntry && entry.copy !== undefined && entry.copy !== null) carrier.copies.add(entry.copy);
            for (const suffix of read.split.stripped) carrier.stripped.add(suffix);
            carrier.databases.add(id);
            carrier.rows += 1;
            const value = row[field];
            if (ranked && Number.isFinite(value) && (carrier.best === null || better(direction, value, carrier.best))) {
                carrier.best = value;
            }
            if (nodecount !== null && (carrier.nodes === null || nodecount > carrier.nodes)) carrier.nodes = nodecount;
            if (Number.isFinite(row.rmsd) && (carrier.rmsd === null || row.rmsd < carrier.rmsd)) carrier.rmsd = row.rmsd;
        });
    }
    return {
        collections, databases, rowsRead, rankingField: field, ranked,
        unparsed: {
            count: unkeyed.size,
            sample: [...unkeyed].sort().slice(0, UNPARSED_SAMPLE),
        },
    };
}

// How many of a side's carriers were keyed at each level.
function keyLevels(side) {
    const levels = { entry: 0, structure: 0 };
    for (const carriers of side.collections.values()) {
        for (const carrier of carriers.values()) levels[carrier.matchLevel] += 1;
    }
    return levels;
}

// Step 5, and the one place a "further guess" is refused.
export function intersectCollection({ collection, left, right, comparable, rows, totals }) {
    const rightIndex = new Map();
    for (const carrier of right.values()) {
        for (const key of [carrier.base, ...carrier.wholeKeys]) {
            if (!rightIndex.has(key)) rightIndex.set(key, new Set());
            rightIndex.get(key).add(carrier.base);
        }
    }
    const matchedRight = new Set();

    for (const carrier of [...left.values()].sort(byBase)) {
        const candidates = comparable
            ? new Set([...[carrier.base, ...carrier.wholeKeys]
                .flatMap(key => [...(rightIndex.get(key) ?? [])])])
            : new Set();
        if (candidates.size > 1) {
            totals.ambiguous += 1;
            rows.push(row(collection, carrier, null, 'ambiguous', [...candidates].sort()));
            continue;
        }
        if (candidates.size === 0) {
            totals.foldOnly += 1;
            rows.push(row(collection, carrier, null, comparable ? 'fold-only' : 'not-comparable', []));
            continue;
        }
        const partner = right.get([...candidates][0]);
        matchedRight.add(partner.base);
        const exact = [...carrier.originals].some(original => partner.originals.has(original));
        if (exact) totals.exact += 1; else totals.normalised += 1;
        totals.both += 1;
        rows.push(row(collection, carrier, partner, exact ? 'exact' : 'normalised', []));
    }

    for (const carrier of [...right.values()].sort(byBase)) {
        if (matchedRight.has(carrier.base)) continue;
        totals.motifOnly += 1;
        rows.push(row(collection, null, carrier, comparable ? 'motif-only' : 'not-comparable', []));
    }
}

const byBase = (a, b) => (a.base < b.base ? -1 : a.base > b.base ? 1 : 0);

// Chain agreement is reported, never assumed.
function chainAgreement(left, right) {
    if (left === null || right === null) return null;
    // Emit no chain label when neither side names one.
    if (left.chains.size === 0 && right.chains.size === 0) return null;
    if (left.chains.size === 0 || right.chains.size === 0) return 'chain-agnostic';
    const shared = [...left.chains].filter(chain => right.chains.has(chain));
    return shared.length > 0 ? 'chain-agreed' : 'chain-mismatch';
}

// Report assembly agreement only when both sides name one.
function assemblyAgreement(left, right) {
    if (left === null || right === null) return null;
    if (left.matchLevel !== 'entry' || right.matchLevel !== 'entry') return null;
    if (left.assemblies.size === 0 || right.assemblies.size === 0) return 'assembly-agnostic';
    const shared = [...left.assemblies].filter(assembly => right.assemblies.has(assembly));
    return shared.length > 0 ? 'assembly-agreed' : 'assembly-agnostic';
}

const row = (collection, left, right, kind, candidates) => ({
    collection,
    base: (left ?? right).base,
    kind,
    foldOriginals: left === null ? [] : [...left.originals].sort(),
    motifOriginals: right === null ? [] : [...right.originals].sort(),
    foldChains: left === null ? [] : [...left.chains].sort(),
    motifChains: right === null ? [] : [...right.chains].sort(),
    stripped: [...new Set([...(left?.stripped ?? []), ...(right?.stripped ?? [])])].sort(),
    foldRows: left?.rows ?? 0,
    motifRows: right?.rows ?? 0,
    nodesBest: right?.nodes ?? null,
    rmsdBest: right?.rmsd === null || right?.rmsd === undefined ? null : round(right.rmsd, 3),
    chainAgreement: chainAgreement(left, right),
    // Record whether the match used an entry or structure key.
    matchLevel: (left ?? right).matchLevel ?? 'structure',
    foldAssemblies: left === null ? [] : [...left.assemblies].sort((a, b) => a - b),
    motifAssemblies: right === null ? [] : [...right.assemblies].sort((a, b) => a - b),
    assemblyAgreement: assemblyAgreement(left, right),
    candidates,
});

const sideReport = (side, manifest) => ({
    artifactId: manifest.artifactId,
    ticket: manifest.state?.ticket ?? null,
    tool: manifest.state?.tool ?? null,
    rankingField: side.rankingField,
    rankingUsable: side.ranked,
    rowsRead: side.rowsRead,
    carriers: [...side.collections.values()].reduce((sum, carriers) => sum + carriers.size, 0),
    databases: side.databases,
});

// Every comparable pair carries the version skew between its two members.
function pairReport(foldSide, motifSide, shared) {
    const pairs = [];
    for (const collection of shared) {
        for (const left of foldSide.databases.filter(entry => entry.collection === collection)) {
            for (const right of motifSide.databases.filter(entry => entry.collection === collection)) {
                pairs.push({
                    collection,
                    fold: { id: left.id, version: left.version },
                    motif: { id: right.id, version: right.version },
                    licensedBy: left.licensedBy === 'assertion' || right.licensedBy === 'assertion'
                        ? 'assertion' : 'collectionMap',
                    versionSkew: left.version !== right.version,
                });
            }
        }
    }
    return pairs;
}

const excludedReport = (foldSide, motifSide, shared) => [
    ...foldSide.databases.filter(entry => !shared.includes(entry.collection))
        .map(entry => ({ side: 'fold', id: entry.id, collection: entry.collection, reason: 'no database of this collection on the motif side' })),
    ...motifSide.databases.filter(entry => !shared.includes(entry.collection))
        .map(entry => ({ side: 'motif', id: entry.id, collection: entry.collection, reason: 'no database of this collection on the fold side' })),
];

// Declare output columns centrally because refusals write no table.
export const INTERSECTION_COLUMNS = Object.freeze(['collection', 'base', 'kind', 'matchLevel',
    'foldOriginals', 'motifOriginals', 'foldChains', 'motifChains', 'foldAssemblies', 'motifAssemblies',
    'assemblyAgreement', 'stripped', 'foldRows', 'motifRows', 'nodesBest', 'rmsdBest', 'chainAgreement',
    'candidates']);

function intersectionTable(rows) {
    return {
        header: [...INTERSECTION_COLUMNS],
        rows: rows.map(entry => ({
            collection: entry.collection,
            base: entry.base,
            kind: entry.kind,
            matchLevel: entry.matchLevel,
            foldOriginals: entry.foldOriginals.join(' '),
            motifOriginals: entry.motifOriginals.join(' '),
            foldChains: entry.foldChains.join(' '),
            motifChains: entry.motifChains.join(' '),
            foldAssemblies: entry.foldAssemblies.join(' '),
            motifAssemblies: entry.motifAssemblies.join(' '),
            assemblyAgreement: entry.assemblyAgreement,
            stripped: entry.stripped.join(' '),
            foldRows: entry.foldRows,
            motifRows: entry.motifRows,
            nodesBest: entry.nodesBest,
            rmsdBest: entry.rmsdBest,
            chainAgreement: entry.chainAgreement,
            candidates: entry.candidates.join(' '),
        })),
    };
}
