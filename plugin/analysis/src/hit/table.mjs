// List leading hits and their observed coverage under one ranking field.

import { saturation } from '../protocol/results.mjs';
import { forEachRow, queryCoverage, quantileSet, round, better, usableDirection } from './rows.mjs';

const FIVE_NUMBER = Object.freeze([0, 0.25, 0.5, 0.75, 1]);
const DESCRIPTION_SUMMARY_LIMIT = 5;

export const table = {
    name: 'hit/table',
    version: 1,
    roles: ['rows'],
    options: ['db', 'sort', 'top'],

    async run(context) {
        const ranking = context.ranking ?? {};
        const sortField = context.args.get('sort') ?? null;
        const field = sortField ?? ranking.field;
        const top = context.top;

        // Read alternative-ranking semantics from the artifact.
        const semantics = sortField === null
            ? { ...ranking }
            : { field: sortField, ...(context.metricSemantics[sortField] ?? {}) };
        const comparable = semantics.crossDatabaseComparable === true;
        if (!comparable) context.warnings.add('CROSS_DATABASE_INCOMPARABLE', { facts: { field } });

        const sat = saturation({ completeness: context.completeness, tool: context.tool });
        if (sat.saturated) {
            context.warnings.add('SATURATED_ROWS', { facts: { rowCap: sat.rowCap, basis: sat.basis } });
        }

        const units = new Map(context.roles.rows.units.map(u => [u.dbIndex, u]));
        const databases = [];
        const kept = [];
        const coverages = [];
        let rowsRead = 0;

        for (const dbIndex of context.selected) {
            const record = context.records.get(dbIndex);
            const unit = units.get(dbIndex);
            const mine = [];

            if (unit && unit.path !== null) {
                await forEachRow(context.root, unit, (row, position) => {
                    const coverage = queryCoverage(row);
                    const description = typeof row.description === 'string' ? row.description : '';
                    if (coverage !== null) coverages.push(coverage);
                    mine.push({
                        // The id the server wrote.
                        id: row.id,
                        dbIndex,
                        db: record?.id ?? null,
                        target: row.target,
                        rankInDatabase: position,
                        value: row[field] ?? null,
                        seqId: row.seqId ?? null,
                        coverage: coverage === null ? null : round(coverage, 3),
                        taxName: row.taxName ?? null,
                        description,
                    });
                });
            }
            rowsRead += mine.length;

            // Re-rank stably only when the caller requests it.
            const ordered = sortField === null
                ? mine
                : [...mine].map((row, i) => [row, i])
                    .sort((a, b) => compare(semantics.direction, a[0].value, b[0].value) || a[1] - b[1])
                    .map(([row]) => row);
            const shown = top === null ? ordered : ordered.slice(0, top);
            for (const row of shown) kept.push(row);

            const descriptions = summarizeDescriptions(mine, shown);
            if (descriptions.missing > 0) {
                context.warnings.add('MISSING_DESCRIPTIONS', {
                    scope: { dbIndex },
                    facts: { total: mine.length, withDescription: descriptions.withDescription },
                });
            }
            databases.push({
                dbIndex,
                id: record?.id ?? null,
                parsedRows: record?.parsedRows ?? null,
                returned: mine.length,
                shown: shown.length,
                descriptions,
            });
            if ((record?.parsedRows ?? 0) === 0) {
                context.warnings.add('ZERO_HIT_DATABASE', { scope: { dbIndex } });
            }
        }

        // Merge ranks only for cross-database-comparable fields.
        const mergeable = comparable && usableDirection(semantics.direction);
        if (comparable && !mergeable) {
            context.warnings.add('INTEGRITY_ISSUE', {
                scope: { field: semantics.field ?? null, reason: 'the declared ranking direction is outside its domain' },
                facts: {
                    declaredDirection: semantics.direction === undefined || semantics.direction === null
                        ? 'absent' : String(semantics.direction),
                    omitted: 'rankMerged',
                },
            });
        }
        const merged = mergeable
            ? [...kept].map((row, i) => [row, i])
                .sort((a, b) => compare(semantics.direction, a[0].value, b[0].value) || a[1] - b[1])
            : [];
        const mergedRank = new Map(merged.map(([row], i) => [row.id, i + 1]));

        const summary = {
            rowsRead,
            rankingField: {
                field: semantics.field ?? null,
                label: semantics.label ?? null,
                direction: semantics.direction ?? null,
                crossDatabaseComparable: comparable,
                alternativeRanking: sortField !== null,
                view: mergeable
                    ? `merged view — ${field}, cross-database comparable`
                    : comparable
                        ? 'per database only — the declared direction is outside its domain, so no merged rank'
                        : 'per database only — ranks are not interleaved',
            },
            metricSemantics: context.metricSemantics,
            coverage: quantileSet(coverages.map(c => round(c, 3)), FIVE_NUMBER),
            databases,
            completeness: context.completeness,
            descriptionBasis: 'server-written annotations for top-ranked hits; no function inference',
        };

        return { summary, tables: { hits: hitsTable(kept, mergedRank, mergeable) } };
    },
};

const compare = (direction, a, b) => {
    const left = Number.isFinite(a) ? a : null;
    const right = Number.isFinite(b) ? b : null;
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return better(direction, left, right) ? -1 : 1;
};

function hitsTable(rows, mergedRank, comparable) {
    const header = ['id', 'dbIndex', 'db', 'rankInDatabase', ...(comparable ? ['rankMerged'] : []),
        'target', 'value', 'seqId', 'coverage', 'taxName', 'description'];
    return {
        header,
        rows: rows.map(row => ({ ...row, rankMerged: mergedRank.get(row.id) ?? '' })),
    };
}

function summarizeDescriptions(rows, ranked) {
    let missing = 0;
    for (const row of rows) {
        if (row.description === '') {
            missing += 1;
        }
    }
    return {
        withDescription: rows.length - missing,
        missing,
        topHits: ranked.slice(0, DESCRIPTION_SUMMARY_LIMIT).map(row => ({
            rankInDatabase: row.rankInDatabase,
            id: row.id,
            target: row.target,
            description: row.description,
        })),
    };
}
