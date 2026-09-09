// Read the shared FoldDisco pattern roster, motif size and strata.

import { readJson } from '../io/streams.mjs';
import { confineExisting } from '../io/paths.mjs';
import { fail } from '../io/errors.mjs';
// Reuse package-wide row and arithmetic helpers.
import { round, ascending, quantileOf, forEachRow } from '../hit/rows.mjs';

export { round, ascending, quantileOf, forEachRow };

// Bound artifact-sized allocations.
export const BOUND = Object.freeze({
    residues: 4096,
    patterns: 1000000,
    rows: 1000000,
});

// Use the lower middle order statistic without interpolation.
export const MEDIAN = 0.5;

// A pattern is one character per query residue: "1" matched, "0" missing.
export function popcount(pattern) {
    let matched = 0;
    for (const character of pattern) if (character === '1') matched += 1;
    return matched;
}

// `{ "A": [120], "C": [23, 27] }` reads as A120, C23, C27.
export function residueLabels(queryResidues) {
    if (queryResidues === null || typeof queryResidues !== 'object' || Array.isArray(queryResidues)) return [];
    const labels = [];
    for (const [chain, numbers] of Object.entries(queryResidues)) {
        if (!Array.isArray(numbers)) continue;
        for (const number of numbers) {
            if (labels.length >= BOUND.residues) return labels;
            if (!Number.isFinite(number)) continue;
            labels.push(`${chain}${number}`);
        }
    }
    return labels;
}

// The roster is read whole because it is one document.
export function readPatterns(root, unit) {
    if (unit === undefined || unit === null || unit.path === null) return null;
    const roster = readJson(confineExisting(root, unit.path), { label: unit.path });
    if (roster === null || typeof roster !== 'object' || !Array.isArray(roster.patterns)) {
        fail('PARSE_FAILED', { file: unit.path, reason: 'no patterns[]' });
    }
    const patterns = [];
    let excluded = 0;
    for (const entry of roster.patterns.slice(0, BOUND.patterns)) {
        const pattern = entry !== null && typeof entry === 'object' && typeof entry.pattern === 'string'
            ? entry.pattern : null;
        const hits = entry !== null && typeof entry === 'object'
            && Number.isInteger(entry.hits) && entry.hits >= 0 ? entry.hits : null;
        if (pattern === null || hits === null || pattern.length === 0 || pattern.length > BOUND.residues) {
            excluded += 1;
            continue;
        }
        patterns.push({ pattern, hits, nodecount: popcount(pattern) });
    }
    return {
        dbIndex: unit.dbIndex,
        queryResidues: residueLabels(roster.queryResidues),
        distinctPatterns: Number.isInteger(roster.distinctPatterns) ? roster.distinctPatterns : null,
        patterns,
        hits: patterns.reduce((sum, entry) => sum + entry.hits, 0),
        widths: [...new Set(patterns.map(entry => entry.pattern.length))],
        excluded,
    };
}

// Resolve motif width from a pattern string, not observed node counts.
export function motifSize(rosters, rowResidueCounts) {
    const present = rosters.filter(roster => roster !== null);
    const widths = [...new Set(present.flatMap(roster => roster.widths))].sort((a, b) => a - b);
    const residueCounts = [...new Set(present.map(roster => roster.queryResidues.length)
        .filter(count => count > 0))].sort((a, b) => a - b);
    const rowCounts = [...new Set(rowResidueCounts.filter(count => count > 0))].sort((a, b) => a - b);
    const cross = { widths, residueCounts, rowCounts };
    const agreed = [...new Set([...widths, ...residueCounts, ...rowCounts])];

    if (widths.length === 1) {
        return { T: widths[0], source: 'pattern-length', consistent: agreed.length === 1, ...cross };
    }
    if (widths.length === 0 && rowCounts.length === 1) {
        return { T: rowCounts[0], source: 'row-query-residues', consistent: agreed.length === 1, ...cross };
    }
    return { T: null, source: null, consistent: false, ...cross };
}

// Report each database-and-motif stratum by node count and `T - nodecount` offset.
export function strataOf({ counts, rowCounts, rmsdByNode, T, parsedRows }) {
    const nodecounts = [...new Set([...counts.keys(), ...rowCounts.keys()])].sort((a, b) => a - b);
    const strata = [];
    for (const nodecount of nodecounts) {
        const values = ascending(rmsdByNode.get(nodecount) ?? []);
        const median = quantileOf(values, MEDIAN);
        const fromRoster = counts.has(nodecount);
        const n = fromRoster ? counts.get(nodecount) : (rowCounts.get(nodecount) ?? 0);
        strata.push({
            nodecount,
            offset: T === null ? null : T - nodecount,
            fullMatch: T !== null && nodecount >= T,
            n,
            census: fromRoster ? 'motif-patterns' : 'rows',
            rate: parsedRows > 0 ? round(n / parsedRows, 6) : null,
            rmsd: spread(values),
        });
    }
    return strata;
}

// n, the two extremes, the middle and the mean.
export function spread(values) {
    const sorted = ascending(values);
    if (sorted.length === 0) return { n: 0, min: null, median: null, mean: null, max: null };
    const total = sorted.reduce((sum, value) => sum + value, 0);
    return {
        n: sorted.length,
        min: round(sorted[0], 3),
        median: round(quantileOf(sorted, MEDIAN), 3),
        mean: round(total / sorted.length, 3),
        max: round(sorted[sorted.length - 1], 3),
    };
}

// Hits by matched-node count, from the pattern roster.
export function countsByNode(roster) {
    const counts = new Map();
    if (roster === null) return counts;
    for (const entry of roster.patterns) {
        counts.set(entry.nodecount, (counts.get(entry.nodecount) ?? 0) + entry.hits);
    }
    return counts;
}

export const histogramsAgree = (left, right) => {
    const keys = new Set([...left.keys(), ...right.keys()]);
    for (const key of keys) if ((left.get(key) ?? 0) !== (right.get(key) ?? 0)) return false;
    return true;
};

// Label reports from the manifest roster, not file paths.
export const labelOf = (records, dbIndex) => ({
    dbIndex,
    id: records.get(dbIndex)?.id ?? null,
    display: records.get(dbIndex)?.display ?? null,
});
