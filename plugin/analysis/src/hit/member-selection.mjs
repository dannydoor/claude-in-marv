// Export hit observations for an explicit member-selection decision.

import { forEachRow, queryCoverage, round } from './rows.mjs';

export const memberSelection = {
    name: 'hit/member-selection',
    version: 1,
    roles: ['rows'],
    options: ['db'],

    async run(context) {
        const ranking = context.ranking ?? {};
        const field = ranking.field ?? null;
        const units = new Map(context.roles.rows.units.map(unit => [unit.dbIndex, unit]));
        const candidates = [];
        const databases = [];

        for (const dbIndex of context.selected) {
            const record = context.records.get(dbIndex);
            const unit = units.get(dbIndex);
            let rowsRead = 0;

            if (unit && unit.path !== null) {
                rowsRead = await forEachRow(context.root, unit, (row, rankInDatabase) => {
                    const coverage = queryCoverage(row);
                    candidates.push({
                        id: row.id,
                        dbIndex,
                        db: record?.id ?? null,
                        target: row.target,
                        rankInDatabase,
                        rankingValue: field === null ? null : (row[field] ?? null),
                        seqId: Number.isFinite(row.seqId) ? row.seqId : null,
                        coverage: coverage === null ? null : round(coverage, 3),
                        organism: row.taxName ?? null,
                        description: typeof row.description === 'string' ? row.description : '',
                    });
                });
            }

            if ((record?.parsedRows ?? 0) === 0) {
                context.warnings.add('ZERO_HIT_DATABASE', { scope: { dbIndex } });
            }
            databases.push({ dbIndex, id: record?.id ?? null, rowsRead });
        }

        const summary = {
            rowsRead: candidates.length,
            rankingField: {
                field,
                label: ranking.label ?? null,
                direction: ranking.direction ?? null,
                crossDatabaseComparable: ranking.crossDatabaseComparable === true,
            },
            databases,
            candidateCount: candidates.length,
            claim: 'candidate observations only; no alignment member is selected automatically',
        };

        return { summary, tables: { candidates: candidatesTable(candidates) } };
    },
};

const candidatesTable = rows => ({
    header: ['id', 'dbIndex', 'db', 'target', 'rankInDatabase', 'rankingValue', 'seqId', 'coverage',
        'organism', 'description'],
    rows,
});
