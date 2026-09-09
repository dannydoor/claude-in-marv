// Summarize motif strata, RMSD, IDF and export saturation.

import { saturation } from '../protocol/results.mjs';
import {
    BOUND, countsByNode, forEachRow, histogramsAgree, labelOf, motifSize, popcount, readPatterns,
    round, spread, strataOf,
} from './motif.mjs';

export const resultMetrics = {
    name: 'folddisco/result-metrics',
    version: 1,
    roles: ['rows', 'motif-patterns'],
    options: [],

    async run(context) {
        const sat = saturation({ completeness: context.completeness, tool: context.tool });
        if (sat.saturated) {
            context.warnings.add('SATURATED_ROWS', { facts: { rowCap: sat.rowCap, basis: sat.basis } });
        }
        const rmsdComparable = context.metricSemantics.rmsd?.crossDatabaseComparable === true;
        const idfField = context.ranking?.field ?? null;
        if (context.ranking?.crossDatabaseComparable !== true) {
            context.warnings.add('CROSS_DATABASE_INCOMPARABLE', { facts: { field: idfField } });
        }

        const patternUnits = new Map(context.roles['motif-patterns'].units.map(unit => [unit.dbIndex, unit]));
        const rowUnits = new Map(context.roles.rows.units.map(unit => [unit.dbIndex, unit]));

        const rosters = new Map();
        for (const dbIndex of context.selected) {
            const roster = readPatterns(context.root, patternUnits.get(dbIndex));
            rosters.set(dbIndex, roster);
            if (roster !== null && roster.excluded > 0) {
                context.warnings.add('INTEGRITY_ISSUE', {
                    scope: { dbIndex }, facts: { excluded: roster.excluded, reason: 'not a pattern with a hit count' },
                });
            }
        }

        // Read each database once for geometry, IDF and query residues.
        const scanned = new Map();
        for (const dbIndex of context.selected) {
            scanned.set(dbIndex, await scanRows(context, rowUnits.get(dbIndex), dbIndex));
        }

        const motif = motifSize([...rosters.values()],
            [...scanned.values()].map(scan => scan.queryResidueCount));
        if (motif.T === null) {
            context.warnings.add('QUERY_RESIDUES_UNAVAILABLE', {
                facts: { widths: motif.widths, rowCounts: motif.rowCounts },
            });
        } else if (!motif.consistent) {
            context.warnings.add('PATTERN_WIDTH_MISMATCH', {
                facts: { widths: motif.widths, residueCounts: motif.residueCounts, rowCounts: motif.rowCounts },
            });
        }

        const perDatabase = [];
        const strata = [];
        const pooledRmsd = [];
        const pooledIdf = [];
        for (const dbIndex of context.selected) {
            const record = context.records.get(dbIndex);
            const parsedRows = record?.parsedRows ?? 0;
            const roster = rosters.get(dbIndex);
            const scan = scanned.get(dbIndex);
            const counts = countsByNode(roster);

            if (!histogramsAgree(counts, scan.byNode) && roster !== null && scan.rowsRead > 0) {
                context.warnings.add('INTEGRITY_ISSUE', {
                    scope: { dbIndex },
                    facts: { reason: 'the pattern roster and the rows disagree about the node-count census' },
                });
            }
            if (rmsdComparable) pooledRmsd.push(...scan.rmsd);
            if (context.ranking?.crossDatabaseComparable === true) pooledIdf.push(...scan.idf);

            // Count full matches from the exported pattern roster.
            const resolved = motif.T !== null && roster !== null;
            const fullMatches = resolved
                ? [...counts].filter(([nodecount]) => nodecount >= motif.T)
                    .reduce((sum, [, hits]) => sum + hits, 0)
                : null;

            const block = {
                ...labelOf(context.records, dbIndex),
                parsedRows,
                rowsRead: scan.rowsRead,
                empty: parsedRows === 0,
                patternHits: roster?.hits ?? null,
                distinctPatterns: roster?.distinctPatterns ?? null,
                distinctStructures: scan.structures.size,
                inflation: scan.structures.size > 0 ? round(scan.rowsRead / scan.structures.size, 3) : null,
                motifSize: motif.T,
                fullMatches,
                fullMatchRate: resolved && parsedRows > 0 ? round(fullMatches / parsedRows, 6) : null,
                fullMatchResolved: resolved && parsedRows > 0,
                nodes: { min: scan.nodes.min, max: scan.nodes.max },
                rmsd: spread(scan.rmsd),
                idf: spread(scan.idf),
            };
            const rows = strataOf({
                counts, rowCounts: scan.byNode, rmsdByNode: scan.rmsdByNode, T: motif.T, parsedRows,
            });
            block.strataCount = rows.length;
            perDatabase.push(block);
            for (const stratum of rows) strata.push({ ...labelOf(context.records, dbIndex), ...stratum });
        }

        const summary = {
            motif: {
                size: motif.T,
                source: motif.source,
                residues: firstResidueList(rosters),
                consistent: motif.consistent,
                observed: { widths: motif.widths, residueCounts: motif.residueCounts, rowCounts: motif.rowCounts },
            },
            // Do not merge rates with different per-database denominators.
            fullMatchRate: {
                pooled: null,
                view: 'per database only — parsedRows differ, so no merged rate exists',
                perDatabase: perDatabase.map(block => ({
                    dbIndex: block.dbIndex,
                    id: block.id,
                    rate: block.fullMatchRate,
                    resolved: block.fullMatchResolved,
                })),
            },
            perDatabase,
            strata,
            // Saturated-export rates describe exported rows, not the database population.
            rateBasis: sat.saturated
                ? 'descriptive of the exported rows only — the table is saturated at the row cap'
                : 'the whole result for each database',
            // RMSD is comparable across databases by the server's own declaration.
            rmsd: rmsdComparable
                ? { view: 'merged view — rmsd, cross-database comparable', ...spread(pooledRmsd) }
                : { view: 'per database only', n: null, min: null, median: null, mean: null, max: null },
            idf: context.ranking?.crossDatabaseComparable === true
                ? { view: `merged view — ${idfField}, cross-database comparable`, ...spread(pooledIdf) }
                : { view: 'per database only', n: null, min: null, median: null, mean: null, max: null },
            completeness: context.completeness,
        };

        return { summary, tables: { strata: strataTable(strata) } };
    },
};

const firstResidueList = rosters => {
    for (const roster of rosters.values()) if (roster !== null && roster.queryResidues.length > 0) return roster.queryResidues;
    return [];
};

// One pass per database.
async function scanRows(context, unit, dbIndex) {
    const rmsd = [];
    const idf = [];
    const rmsdByNode = new Map();
    const byNode = new Map();
    const structures = new Set();
    let queryResidueCount = 0;
    let nodeMin = null;
    let nodeMax = null;
    let excluded = 0;

    const rowsRead = await forEachRow(context.root, unit ?? { path: null }, row => {
        if (structures.size < BOUND.rows && typeof row.target === 'string' && row.target !== '') {
            structures.add(row.target);
        }
        if (queryResidueCount === 0 && typeof row.queryresidues === 'string' && row.queryresidues !== '') {
            queryResidueCount = row.queryresidues.split(',').length;
        }
        const nodecount = Number.isInteger(row.nodecount) && row.nodecount >= 0
            && row.nodecount <= BOUND.residues
            ? row.nodecount
            : (typeof row.motifPattern === 'string' ? popcount(row.motifPattern) : null);
        if (nodecount === null) {
            excluded += 1;
            return;
        }
        byNode.set(nodecount, (byNode.get(nodecount) ?? 0) + 1);
        nodeMin = nodeMin === null || nodecount < nodeMin ? nodecount : nodeMin;
        nodeMax = nodeMax === null || nodecount > nodeMax ? nodecount : nodeMax;
        if (Number.isFinite(row.rmsd)) {
            rmsd.push(row.rmsd);
            if (!rmsdByNode.has(nodecount)) rmsdByNode.set(nodecount, []);
            rmsdByNode.get(nodecount).push(row.rmsd);
        }
        if (Number.isFinite(row.idfscore)) idf.push(row.idfscore);
    });

    if (excluded > 0) {
        context.warnings.add('INTEGRITY_ISSUE', {
            scope: { dbIndex }, facts: { excluded, reason: 'a row declares no usable matched-node count' },
        });
    }
    return { rowsRead, rmsd, idf, rmsdByNode, byNode, structures, queryResidueCount, nodes: { min: nodeMin, max: nodeMax } };
}

function strataTable(strata) {
    const header = ['dbIndex', 'database', 'nodecount', 'offset', 'fullMatch', 'n', 'census', 'rate',
        'rmsdN', 'rmsdMin', 'rmsdMedian', 'rmsdMean', 'rmsdMax'];
    const rows = strata.map(stratum => ({
        dbIndex: stratum.dbIndex,
        database: stratum.id,
        nodecount: stratum.nodecount,
        offset: stratum.offset,
        fullMatch: stratum.fullMatch,
        n: stratum.n,
        census: stratum.census,
        rate: stratum.rate,
        rmsdN: stratum.rmsd.n,
        rmsdMin: stratum.rmsd.min,
        rmsdMedian: stratum.rmsd.median,
        rmsdMean: stratum.rmsd.mean,
        rmsdMax: stratum.rmsd.max,
    }));
    return { header, rows };
}
