// Per-database counts, table saturation and the ranking-field distribution.

import { saturation } from '../protocol/results.mjs';
import { forEachRow, quantileSet, round } from './rows.mjs';

const FIVE_NUMBER = Object.freeze([0, 0.25, 0.5, 0.75, 1]);

export const survey = {
    name: 'hit/survey',
    version: 1,
    roles: ['rows'],
    options: ['db'],

    async run(context) {
        const ranking = context.ranking ?? {};
        const field = ranking.field ?? null;

        const sat = saturation({ completeness: context.completeness, tool: context.tool });
        if (sat.saturated) {
            context.warnings.add('SATURATED_ROWS', { facts: { rowCap: sat.rowCap, basis: sat.basis } });
        }
        // Ranking direction and comparability are the server's statement about this field.
        if (ranking.crossDatabaseComparable !== true) {
            context.warnings.add('CROSS_DATABASE_INCOMPARABLE', { facts: { field } });
        }

        const units = new Map(context.roles.rows.units.map(u => [u.dbIndex, u]));
        const databases = [];
        const pooled = [];

        for (const dbIndex of context.selected) {
            const record = context.records.get(dbIndex);
            const unit = units.get(dbIndex);
            const values = [];
            let topHit = null;
            let rowsRead = 0;

            if (unit && unit.path !== null) {
                rowsRead = await forEachRow(context.root, unit, row => {
                    // The first row is the top hit under the declared ranking.
                    if (topHit === null) topHit = { id: row.id, target: row.target, value: row[field] ?? null };
                    const value = row[field];
                    if (Number.isFinite(value)) values.push(value);
                });
            }
            if ((record?.parsedRows ?? 0) === 0) {
                context.warnings.add('ZERO_HIT_DATABASE', { scope: { dbIndex } });
            }
            if (ranking.crossDatabaseComparable === true) pooled.push(...values);

            databases.push({
                dbIndex,
                id: record?.id ?? null,
                display: record?.display ?? null,
                parsedRows: record?.parsedRows ?? null,
                rowsRead,
                taxonomyTree: record?.taxonomyTree === true,
                topHit,
                quantiles: quantileSet(values, FIVE_NUMBER),
            });
        }

        const summary = {
            rankingField: {
                field,
                label: ranking.label ?? null,
                direction: ranking.direction ?? null,
                crossDatabaseComparable: ranking.crossDatabaseComparable === true,
            },
            databases,
            // Merge distributions only for cross-database-comparable fields.
            quantiles: ranking.crossDatabaseComparable === true
                ? { view: `merged view — ${field}, cross-database comparable`, ...quantileSet(pooled, FIVE_NUMBER) }
                : { view: 'per database only', n: null, at: [] },
            completeness: context.completeness,
        };

        return { summary, tables: { 'db-summary': table(databases, FIVE_NUMBER) } };
    },
};

function table(databases, fractions) {
    const header = ['dbIndex', 'id', 'parsedRows', 'rowsRead', 'taxonomyTree', 'topHitId', 'topHitTarget',
        ...fractions.map(p => `q${round(p * 100, 4)}`)];
    const rows = databases.map(db => {
        const row = {
            dbIndex: db.dbIndex,
            id: db.id,
            parsedRows: db.parsedRows,
            rowsRead: db.rowsRead,
            taxonomyTree: db.taxonomyTree,
            topHitId: db.topHit?.id ?? '',
            topHitTarget: db.topHit?.target ?? '',
        };
        for (const point of db.quantiles.at) row[`q${round(point.q * 100, 4)}`] = point.value ?? '';
        return row;
    });
    return { header, rows };
}
