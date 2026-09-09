// Rank every exported alignment column by the server's conservation score.

import { loadEntries, loadColumns, round, displayCap } from './alignment.mjs';

const LISTED = 15;

export const columnRanking = {
    name: 'msa/column-ranking',
    version: 1,
    roles: ['msa-columns', 'msa-entries'],
    requires: ['msa-columns', 'msa-entries'],
    options: ['top'],

    async run(context) {
        const roster = loadEntries(context);
        const columns = await loadColumns(context, roster);
        const ranked = columns.map(column => ({
            column: column.column,
            oneBased: column.oneBased,
            glyph: column.glyph,
            conservationScore: column.score,
            positive: column.positive,
            negative: column.negative,
            isIdentity: column.isIdentity,
            isFullyConserved: column.isFullyConserved,
            occupancy: round(column.occupancy, 4),
            nonGapCount: column.nonGapCount,
            modalFraction: column.modalFraction === null ? null : round(column.modalFraction, 4),
            lddt: column.lddt === null ? null : round(column.lddt, 6),
            entropy: column.entropy === null ? null : round(column.entropy, 6),
        })).sort((a, b) => ((b.conservationScore ?? -1) - (a.conservationScore ?? -1))
            || (a.column - b.column));
        ranked.forEach((entry, index) => { entry.rank = index + 1; });

        const unscored = ranked.filter(column => column.conservationScore === null).length;
        if (unscored > 0) {
            context.warnings.add('MISSING_COLUMN_METRIC', {
                facts: { metric: 'conservationScore', unscored, columns: columns.length },
            });
        }

        const summary = {
            entries: roster.count,
            columns: columns.length,
            rankingField: 'conservationScore',
            candidateCount: ranked.length,
            ranked: ranked.slice(0, displayCap(context, LISTED)),
            claim: 'observed column order only; selecting residues remains an explicit decision',
        };

        return { summary, tables: { 'columns-ranked': table(ranked) } };
    },
};

const table = ranked => ({
    header: ['rank', 'column', 'oneBased', 'glyph', 'conservationScore', 'positive', 'negative',
        'isIdentity', 'isFullyConserved', 'occupancy', 'nonGapCount', 'modalFraction', 'lddt', 'entropy'],
    rows: ranked.map(entry => ({
        ...entry,
        conservationScore: entry.conservationScore ?? '',
        positive: entry.positive.join(' '),
        negative: entry.negative.join(' '),
        modalFraction: entry.modalFraction ?? '',
        lddt: entry.lddt ?? '',
        entropy: entry.entropy ?? '',
    })),
});
