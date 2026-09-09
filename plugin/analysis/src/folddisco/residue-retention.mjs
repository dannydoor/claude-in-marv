// Report hit-weighted residue retention and omission.

import { saturation } from '../protocol/results.mjs';
import { forEachRow, labelOf, motifSize, readPatterns, round, spread } from './motif.mjs';

export const residueRetention = {
    name: 'folddisco/residue-retention',
    version: 1,
    roles: ['motif-patterns', 'rows'],
    options: [],

    async run(context) {
        const sat = saturation({ completeness: context.completeness, tool: context.tool });
        if (sat.saturated) {
            context.warnings.add('SATURATED_ROWS', { facts: { rowCap: sat.rowCap, basis: sat.basis } });
        }

        const patternUnits = new Map(context.roles['motif-patterns'].units.map(unit => [unit.dbIndex, unit]));
        const rowUnits = new Map(context.roles.rows.units.map(unit => [unit.dbIndex, unit]));
        const rosters = new Map();
        const scanned = new Map();
        for (const dbIndex of context.selected) {
            rosters.set(dbIndex, readPatterns(context.root, patternUnits.get(dbIndex)));
            scanned.set(dbIndex, await countRows(context, rowUnits.get(dbIndex)));
        }
        // The rows are read for their own count AND for the query residue list they carry.
        const motif = motifSize([...rosters.values()],
            [...scanned.values()].map(scan => scan.queryResidueCount));
        if (motif.T === null) {
            context.warnings.add('QUERY_RESIDUES_UNAVAILABLE', { facts: { widths: motif.widths } });
        } else if (!motif.consistent) {
            context.warnings.add('PATTERN_WIDTH_MISMATCH', {
                facts: { widths: motif.widths, residueCounts: motif.residueCounts },
            });
        }

        const perDatabase = [];
        const perResidue = [];

        for (const dbIndex of context.selected) {
            const label = labelOf(context.records, dbIndex);
            const roster = rosters.get(dbIndex);
            // Refuse disagreements between row and roster denominators.
            const rowsRead = scanned.get(dbIndex).rowsRead;
            if (roster === null || roster.hits === 0 || motif.T === null) {
                perDatabase.push({
                    ...label, patterns: roster?.patterns.length ?? 0, hits: roster?.hits ?? 0, rowsRead,
                    matchFraction: spread([]), empty: true,
                });
                continue;
            }
            if (rowsRead > 0 && rowsRead !== roster.hits) {
                context.warnings.add('INTEGRITY_ISSUE', {
                    scope: { dbIndex },
                    facts: { patternHits: roster.hits, rowsRead, reason: 'the roster and the rows count different exports' },
                });
            }

            const residues = roster.queryResidues.length === motif.T
                ? roster.queryResidues
                : indexLabels(motif.T);
            const matched = new Array(motif.T).fill(0);
            for (const entry of roster.patterns) {
                for (let index = 0; index < motif.T; index += 1) {
                    if (entry.pattern[index] !== '1') continue;
                    matched[index] += entry.hits;
                }
            }

            const fractions = matched.map(hits => hits / roster.hits);
            for (let index = 0; index < motif.T; index += 1) {
                const matchFraction = round(fractions[index], 3);
                perResidue.push({
                    ...label,
                    index,
                    residue: residues[index],
                    matchedHits: matched[index],
                    omittedHits: roster.hits - matched[index],
                    matchFraction,
                    omissionFraction: round(1 - fractions[index], 3),
                });
            }

            perDatabase.push({
                ...label,
                patterns: roster.patterns.length,
                hits: roster.hits,
                rowsRead,
                matchFraction: spread(fractions),
                empty: false,
            });
        }

        const summary = {
            motif: { size: motif.T, source: motif.source, consistent: motif.consistent },
            perDatabase,
            perResidue,
            completeness: context.completeness,
            claimLimit: 'descriptive hit-weighted residue retention; it does not establish biological essentiality',
        };
        return { summary, tables: { patterns: patternsTable(perResidue) } };
    },
};

const indexLabels = width => Array.from({ length: width }, (_, index) => `#${index}`);

// One pass per database: how many rows there are, and the query residue list they repeat.
async function countRows(context, unit) {
    let queryResidueCount = 0;
    const rowsRead = await forEachRow(context.root, unit ?? { path: null }, row => {
        if (queryResidueCount === 0 && typeof row.queryresidues === 'string' && row.queryresidues !== '') {
            queryResidueCount = row.queryresidues.split(',').length;
        }
    });
    return { rowsRead, queryResidueCount };
}

function patternsTable(perResidue) {
    const header = ['dbIndex', 'database', 'index', 'residue', 'matchedHits', 'omittedHits',
        'matchFraction', 'omissionFraction'];
    const rows = perResidue.map(row => ({
        dbIndex: row.dbIndex,
        database: row.id,
        index: row.index,
        residue: row.residue,
        matchedHits: row.matchedHits,
        omittedHits: row.omittedHits,
        matchFraction: row.matchFraction,
        omissionFraction: row.omissionFraction,
    }));
    return { header, rows };
}
