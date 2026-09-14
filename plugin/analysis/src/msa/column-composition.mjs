// Describe selected columns without choosing substitutions or motif residues.

import { loadEntries, loadColumns, loadAligned, round, GAP } from './alignment.mjs';
import { namedEntry, requestedColumns } from './motif-input.mjs';

const GROUP = Object.freeze({
    positive: 'p', negative: 'n', polar: 'h', hydrophobic: 'b', aromatic: 'a',
});

export const columnComposition = {
    name: 'msa/column-composition',
    version: 1,
    roles: ['msa-columns', 'msa-entries', 'msa-fasta-aa'],
    requires: ['msa-columns', 'msa-entries', 'msa-fasta-aa'],
    options: ['columns', 'entry'],

    async run(context) {
        const roster = loadEntries(context);
        const reference = namedEntry(context, roster);
        const requested = requestedColumns(context, roster);
        const columns = await loadColumns(context, roster);
        const referenceRow = (await loadAligned(context, 'msa-fasta-aa', roster)).get(reference.name);
        const byIndex = new Map(columns.map(column => [column.column, column]));
        const perColumn = [];

        for (const index of requested) {
            const column = byIndex.get(index) ?? null;
            const referenceGlyph = referenceRow[index] ?? null;
            if (column === null) {
                context.warnings.add('MISSING_COLUMN_METRIC', {
                    scope: { reason: 'the exporter emitted no usable record for this column' }, id: index,
                });
                perColumn.push(missing(index, referenceGlyph));
                continue;
            }

            if (referenceGlyph === GAP) {
                context.warnings.add('REFERENCE_RESIDUE_ABSENT', {
                    scope: { entryName: reference.name, column: index }, id: index,
                });
            }
            const mapped = column.positive
                .filter(property => Object.hasOwn(GROUP, property))
                .map(property => ({ property, groupCode: GROUP[property] }));
            const candidateGroupCodes = [...new Set(mapped.map(entry => entry.groupCode))].sort();
            const unmappedPositive = column.positive.filter(property => !Object.hasOwn(GROUP, property));
            const letters = column.letters
                .filter(letter => letter.glyph !== '' && letter.glyph !== GAP)
                .map(letter => ({
                    glyph: letter.glyph,
                    count: letter.count,
                    fraction: letter.logoFraction === null ? null : round(letter.logoFraction, 4),
                }));

            perColumn.push({
                column: column.column,
                oneBased: column.oneBased,
                status: referenceGlyph === GAP ? 'reference-gap' : (column.isIdentity ? 'identity' : 'variable'),
                referenceGlyph,
                consensusGlyph: column.glyph,
                isIdentity: column.isIdentity,
                conservationScore: column.score,
                modalFraction: column.modalFraction === null ? null : round(column.modalFraction, 4),
                positive: column.positive,
                negative: column.negative,
                mappedProperties: mapped,
                candidateGroupCodes,
                unmappedPositive,
                letters,
            });
        }

        context.selectors = { entry: reference.name, columns: requested };

        const summary = {
            entryName: reference.name,
            entryIndex: reference.index,
            columnsRequested: requested,
            groupCodes: GROUP,
            perColumn,
            claimLimit: 'descriptive column composition and property evidence; no substitution or motif residue is selected automatically',
        };
        return { summary, tables: { 'column-composition': tableOf(perColumn, reference) } };
    },
};

const missing = (column, referenceGlyph) => ({
    column,
    oneBased: column + 1,
    status: 'unscored',
    referenceGlyph,
    consensusGlyph: '',
    isIdentity: null,
    conservationScore: null,
    modalFraction: null,
    positive: [],
    negative: [],
    mappedProperties: [],
    candidateGroupCodes: [],
    unmappedPositive: [],
    letters: [],
});

function tableOf(perColumn, reference) {
    const header = ['column', 'oneBased', 'entryName', 'status', 'referenceGlyph', 'consensusGlyph',
        'isIdentity', 'conservationScore', 'modalFraction', 'positive', 'negative', 'candidateGroupCodes',
        'unmappedPositive', 'letters'];
    const rows = perColumn.map(entry => ({
        column: entry.column,
        oneBased: entry.oneBased,
        entryName: reference.name,
        status: entry.status,
        referenceGlyph: entry.referenceGlyph ?? '',
        consensusGlyph: entry.consensusGlyph,
        isIdentity: entry.isIdentity ?? '',
        conservationScore: entry.conservationScore ?? '',
        modalFraction: entry.modalFraction ?? '',
        positive: entry.positive.join(' '),
        negative: entry.negative.join(' '),
        candidateGroupCodes: entry.candidateGroupCodes.join(''),
        unmappedPositive: entry.unmappedPositive.join(' '),
        letters: entry.letters.map(letter => `${letter.glyph}:${letter.count ?? ''}:${letter.fraction ?? ''}`).join(' '),
    }));
    return { header, rows };
}
