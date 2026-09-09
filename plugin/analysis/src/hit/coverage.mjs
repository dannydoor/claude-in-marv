// Exact query-residue coverage across the exported hit alignments.

import { forEachRow, alignments, queryOf, round } from './rows.mjs';

export const coverage = {
    name: 'hit/coverage',
    version: 1,
    roles: ['rows'],
    options: ['db'],

    async run(context) {
        const units = new Map(context.roles.rows.units.map(u => [u.dbIndex, u]));
        const groups = new Map();
        const budget = { allocated: 0 };
        const dropped = new Map();
        const note = (dbIndex, reason, id) => {
            const key = `${dbIndex} ${reason}`;
            if (!dropped.has(key)) dropped.set(key, { dbIndex, reason, ids: [] });
            dropped.get(key).ids.push(id);
        };

        for (const dbIndex of context.selected) {
            const unit = units.get(dbIndex);
            if (!unit || unit.path === null) continue;
            await forEachRow(context.root, unit, row => {
                const { entries, excluded } = alignments(row);
                if (excluded > 0) note(dbIndex, 'a nested alignment is not an object', row.id);
                for (const alignment of entries) {
                    const reason = collect(groups, alignment, dbIndex, budget);
                    if (reason !== null) note(dbIndex, reason, row.id);
                }
            });
        }

        // Reported, never silent.
        for (const { dbIndex, reason, ids } of [...dropped.values()]
            .sort((a, b) => a.dbIndex - b.dbIndex || (a.reason < b.reason ? -1 : 1))) {
            for (const id of ids) {
                context.warnings.add('INTEGRITY_ISSUE', { scope: { dbIndex, reason }, id });
            }
        }

        const profiles = [...groups.values()]
            .sort((a, b) => codepoint(a.query, b.query) || a.queryLength - b.queryLength)
            .map(profile);
        const perQuery = profiles.map(entry => entry.summary);

        const summary = {
            queries: perQuery.length,
            perQuery,
            claim: 'coverage runs describe exported alignments and do not assign domains or architecture',
        };
        return { summary, tables: { 'coverage-runs': coverageTable(profiles) } };
    },
};

// A query length has to be a residue count before it can be an array length.
const usableLength = length => Number.isInteger(length) && length > 0 && length <= 1000000;

// Bound total profile width well above real queries but below unsafe memory use.
const residueBudget = 10000000;

function collect(groups, alignment, dbIndex, budget) {
    const length = alignment.qLen;
    if (!usableLength(length)) return 'the query length is not a residue count';
    // Include query length in profile keys to prevent incompatible merges.
    const key = `${queryOf(alignment) ?? ''} ${length}`;
    if (!groups.has(key)) {
        if (budget.allocated + length > residueBudget) {
            return 'the profiles would allocate more than this subcommand may hold';
        }
        budget.allocated += length;
        groups.set(key, {
            query: queryOf(alignment), queryLength: length,
            depth: new Array(length).fill(0),
            hits: 0,
            databases: new Set(),
        });
    }
    const group = groups.get(key);
    group.hits += 1;
    group.databases.add(dbIndex);
    const from = Math.max(1, alignment.qStartPos);
    const to = Math.min(length, alignment.qEndPos);
    for (let residue = from; residue <= to; residue += 1) group.depth[residue - 1] += 1;

    return null;
}

const codepoint = (a, b) => {
    const x = String(a);
    const y = String(b);
    return x < y ? -1 : x > y ? 1 : 0;
};

function profile(group) {
    const runs = [];
    let start = 0;
    for (let i = 1; i <= group.depth.length; i += 1) {
        if (i === group.depth.length || group.depth[i] !== group.depth[start]) {
            const depth = group.depth[start];
            runs.push({
                from: start + 1,
                to: i,
                len: i - start,
                depth,
                hitFraction: group.hits === 0 ? 0 : round(depth / group.hits, 3),
            });
            start = i;
        }
    }
    const coveredResidues = group.depth.filter(depth => depth > 0).length;
    const depthTotal = group.depth.reduce((sum, depth) => sum + depth, 0);
    return { summary: {
        query: group.query,
        queryLength: group.queryLength,
        hits: group.hits,
        databases: [...group.databases].sort((a, b) => a - b),
        depth: {
            coveredResidues,
            uncoveredResidues: group.queryLength - coveredResidues,
            coveredFraction: round(coveredResidues / group.queryLength, 3),
            mean: round(depthTotal / group.queryLength, 3),
            max: group.depth.reduce((highest, depth) => Math.max(highest, depth), 0),
        },
    }, runs };
}

function coverageTable(profiles) {
    const rows = [];
    for (const entry of profiles) {
        for (const run of entry.runs) {
            rows.push({
                query: entry.summary.query,
                queryLength: entry.summary.queryLength,
                from: run.from,
                to: run.to,
                len: run.len,
                depth: run.depth,
                hitFraction: run.hitFraction,
            });
        }
    }
    return { header: ['query', 'queryLength', 'from', 'to', 'len', 'depth', 'hitFraction'], rows };
}
