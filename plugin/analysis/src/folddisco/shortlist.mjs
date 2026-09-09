// List review candidates in each database's own ranking.

import { saturation } from '../protocol/results.mjs';
import { better } from '../hit/rows.mjs';
import { BOUND, forEachRow, labelOf, motifSize, popcount, readPatterns, round } from './motif.mjs';

const LISTED = 20;

export const shortlist = {
    name: 'folddisco/shortlist',
    version: 1,
    roles: ['rows', 'motif-patterns'],
    options: ['top'],

    async run(context) {
        const limitPerDatabase = Math.min(context.top ?? LISTED, BOUND.rows);
        const sat = saturation({ completeness: context.completeness, tool: context.tool });
        if (sat.saturated) {
            context.warnings.add('SATURATED_ROWS', { facts: { rowCap: sat.rowCap, basis: sat.basis } });
        }

        const direction = context.ranking?.direction ?? null;
        const field = context.ranking?.field ?? null;
        if (context.ranking?.crossDatabaseComparable !== true) {
            context.warnings.add('CROSS_DATABASE_INCOMPARABLE', { facts: { field } });
        }

        const patternUnits = new Map(context.roles['motif-patterns'].units.map(unit => [unit.dbIndex, unit]));
        const rowUnits = new Map(context.roles.rows.units.map(unit => [unit.dbIndex, unit]));
        const rosters = new Map();
        const collected = new Map();
        for (const dbIndex of context.selected) {
            rosters.set(dbIndex, readPatterns(context.root, patternUnits.get(dbIndex)));
            collected.set(dbIndex, await collect(context, rowUnits.get(dbIndex), dbIndex));
        }

        const motif = motifSize([...rosters.values()],
            [...collected.values()].map(rows => rows.queryResidueCount));
        if (motif.T === null) {
            context.warnings.add('QUERY_RESIDUES_UNAVAILABLE', { facts: { widths: motif.widths } });
        }

        const perDatabase = [];
        const shown = [];
        for (const dbIndex of context.selected) {
            const label = labelOf(context.records, dbIndex);
            const candidates = collected.get(dbIndex).rows;
            for (const row of candidates) {
                row.offset = motif.T === null ? null : motif.T - row.nodecount;
                row.fullMatch = motif.T !== null && row.nodecount >= motif.T;
            }
            candidates.sort((left, right) => order(left, right, direction));
            const listed = candidates.slice(0, limitPerDatabase).map((row, index) => ({
                rankInDatabase: index + 1,
                ...label,
                ...row,
            }));
            shown.push(...listed);
            perDatabase.push({
                ...label,
                candidates: candidates.length,
                shown: listed.length,
                hasDescription: context.records.get(dbIndex)?.hasDescription === true,
            });
        }

        const summary = {
            motif: { size: motif.T, source: motif.source },
            merged: false,
            rankingField: {
                field,
                direction,
                crossDatabaseComparable: context.ranking?.crossDatabaseComparable === true,
            },
            limitPerDatabase,
            perDatabase,
            completeness: context.completeness,
        };
        return { summary, tables: { shortlist: shortlistTable(shown) } };
    },
};

const order = (left, right, direction) => {
    if (left.value !== right.value) return better(direction, left.value, right.value) ? -1 : 1;
    return left.rowId < right.rowId ? -1 : (left.rowId > right.rowId ? 1 : 0);
};

async function collect(context, unit, dbIndex) {
    const field = context.ranking?.field ?? null;
    const rows = [];
    let queryResidueCount = 0;
    let excluded = 0;
    await forEachRow(context.root, unit ?? { path: null }, row => {
        if (queryResidueCount === 0 && typeof row.queryresidues === 'string' && row.queryresidues !== '') {
            queryResidueCount = row.queryresidues.split(',').length;
        }
        if (rows.length >= BOUND.rows) return;
        const value = row[field];
        const nodecount = Number.isInteger(row.nodecount) && row.nodecount >= 0 && row.nodecount <= BOUND.residues
            ? row.nodecount
            : (typeof row.motifPattern === 'string' ? popcount(row.motifPattern) : null);
        if (!Number.isFinite(value) || nodecount === null) {
            excluded += 1;
            return;
        }
        rows.push({
            dbIndex,
            rowId: String(row.id),
            target: typeof row.target === 'string' ? row.target : null,
            targetName: typeof row.targetname === 'string' ? row.targetname : null,
            description: typeof row.description === 'string' ? row.description : '',
            nodecount,
            offset: null,
            fullMatch: false,
            value,
            rmsd: Number.isFinite(row.rmsd) ? round(row.rmsd, 3) : null,
        });
    });
    if (excluded > 0) {
        context.warnings.add('INTEGRITY_ISSUE', {
            scope: { dbIndex }, facts: { excluded, reason: 'a row declares no usable ranking value or node count' },
        });
    }
    return { rows, queryResidueCount };
}

function shortlistTable(rows) {
    const header = ['rankInDatabase', 'dbIndex', 'database', 'rowId', 'target', 'targetName', 'nodecount',
        'offset', 'fullMatch', 'rankingValue', 'rmsd', 'description'];
    return {
        header,
        rows: rows.map(row => ({
            rankInDatabase: row.rankInDatabase,
            dbIndex: row.dbIndex,
            database: row.id,
            rowId: row.rowId,
            target: row.target,
            targetName: row.targetName,
            nodecount: row.nodecount,
            offset: row.offset,
            fullMatch: row.fullMatch,
            rankingValue: round(row.value, 3),
            rmsd: row.rmsd,
            description: row.description,
        })),
    };
}
