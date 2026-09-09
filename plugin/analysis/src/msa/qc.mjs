// Report alignment-wide occupancy, conservation, and identity observations.

import {
    loadEntries, loadColumns, loadAligned, identityMatrix, degradedRoles,
    quantileOf, round, rolePresent, ascending, MEDIAN,
} from './alignment.mjs';

const OPTIONAL = ['msa-fasta-aa'];

export const qc = {
    name: 'msa/qc',
    version: 1,
    roles: ['msa-columns', 'msa-entries', 'msa-fasta-aa'],
    requires: ['msa-columns', 'msa-entries'],
    options: [],

    async run(context) {
        const roster = loadEntries(context);
        const columns = await loadColumns(context, roster);
        const occupancies = ascending(columns.map(column => column.occupancy));
        const identityColumns = columns.filter(column => column.isIdentity).length;
        const propertyConservedColumns = columns.filter(column => column.isFullyConserved).length;
        const unscored = columns.filter(column => column.lddt === null).length;

        if (unscored > 0) {
            context.warnings.add('MISSING_COLUMN_METRIC', {
                facts: { metric: 'lddt', unscored, columns: columns.length },
            });
        }

        const pairwiseIdentity = rolePresent(context, 'msa-fasta-aa')
            ? summarizeIdentity(identityMatrix(roster, await loadAligned(context, 'msa-fasta-aa', roster)))
            : null;

        const summary = {
            entries: roster.count,
            columns: columns.length,
            occupancy: {
                n: occupancies.length,
                min: round(occupancies[0], 4),
                median: round(quantileOf(occupancies, MEDIAN), 4),
                mean: round(occupancies.reduce((sum, value) => sum + value, 0) / occupancies.length, 4),
                max: round(occupancies[occupancies.length - 1], 4),
            },
            conservation: {
                denominator: 'all exported alignment columns',
                identityColumns,
                identityFraction: round(identityColumns / columns.length, 4),
                propertyConservedColumns,
                propertyConservedFraction: round(propertyConservedColumns / columns.length, 4),
            },
            pairwiseIdentity,
            degraded: degradedRoles(context, OPTIONAL),
        };

        return { summary, tables: { columns: table(columns) } };
    },
};

function summarizeIdentity(matrix) {
    const values = matrix.values;
    if (values.length === 0) return { pairs: 0, min: null, median: null, max: null };
    return {
        pairs: values.length,
        min: round(values[0], 4),
        median: round(quantileOf(values, MEDIAN), 4),
        max: round(values[values.length - 1], 4),
    };
}

const table = columns => ({
    header: ['column', 'oneBased', 'occupancy', 'nonGapCount', 'conservationScore', 'isIdentity',
        'isFullyConserved', 'consensusGlyph', 'modalFraction', 'lddt'],
    rows: columns.map(column => ({
        column: column.column,
        oneBased: column.oneBased,
        occupancy: round(column.occupancy, 4),
        nonGapCount: column.nonGapCount,
        conservationScore: column.score ?? '',
        isIdentity: column.isIdentity,
        isFullyConserved: column.isFullyConserved,
        consensusGlyph: column.glyph,
        modalFraction: column.modalFraction === null ? '' : round(column.modalFraction, 4),
        lddt: column.lddt === null ? '' : round(column.lddt, 6),
    })),
});
