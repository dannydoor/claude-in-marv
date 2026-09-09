// Report each alignment member's occupancy and consensus agreement.

import { loadEntries, loadColumns, loadAligned, degradedRoles, rolePresent, round, GAP } from './alignment.mjs';

const OPTIONAL = ['msa-fasta-aa', 'msa-fasta-3di'];

export const memberAudit = {
    name: 'msa/member-audit',
    version: 1,
    roles: ['msa-columns', 'msa-entries', 'msa-fasta-aa', 'msa-fasta-3di'],
    requires: ['msa-columns', 'msa-entries'],
    options: [],

    async run(context) {
        const roster = loadEntries(context);
        const columns = await loadColumns(context, roster);
        const hasAa = rolePresent(context, 'msa-fasta-aa');
        const alphabet = hasAa ? 'msa-fasta-aa' : (rolePresent(context, 'msa-fasta-3di') ? 'msa-fasta-3di' : null);
        const rows = alphabet === null ? null : await loadAligned(context, alphabet, roster);
        const consensus = new Map(columns.map(column => [column.column, column.glyph]));

        const entries = roster.entries.map(entry => {
            const row = rows?.get(entry.name) ?? null;
            const occupied = row === null ? null : occupiedColumns(row, columns);
            const occupiedFraction = occupied === null ? null : occupied.size / columns.length;
            return {
                index: entry.index,
                name: entry.name,
                residueCount: entry.residueCount,
                occupiedColumns: occupied?.size ?? null,
                occupiedFraction: occupiedFraction === null ? null : round(occupiedFraction, 4),
                gapFraction: occupiedFraction === null ? null : round(1 - occupiedFraction, 4),
                consensusAgreement: hasAa && occupied !== null
                    ? round(consensusAgreement(row, columns, consensus), 4)
                    : null,
            };
        });

        const summary = {
            entries: roster.count,
            columns: columns.length,
            gapPatternFrom: alphabet,
            identityLegs: hasAa ? 'computed' : 'unavailable: the amino-acid rows are absent',
            degraded: degradedRoles(context, OPTIONAL),
        };

        return { summary, tables: { members: table(entries) } };
    },
};

const occupiedColumns = (row, columns) => new Set(columns
    .filter(column => row[column.column] !== undefined && row[column.column] !== GAP)
    .map(column => column.column));

function consensusAgreement(row, columns, consensus) {
    let occupied = 0;
    let agree = 0;
    for (const column of columns) {
        const glyph = row[column.column];
        if (glyph === undefined || glyph === GAP) continue;
        occupied += 1;
        if (glyph === consensus.get(column.column)) agree += 1;
    }
    return occupied === 0 ? 0 : agree / occupied;
}

const table = entries => ({
    header: ['index', 'name', 'residueCount', 'occupiedColumns', 'occupiedFraction', 'gapFraction',
        'consensusAgreement'],
    rows: entries.map(entry => Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, value ?? '']))),
});
