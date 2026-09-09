// Report contiguous runs with the same observed member support.

import { loadEntries, loadColumns, loadAligned, degradedRoles, rolePresent, round, GAP, displayCap } from './alignment.mjs';

const OPTIONAL = ['msa-fasta-aa', 'msa-fasta-3di'];
const LISTED = 10;

export const blocks = {
    name: 'msa/blocks',
    version: 1,
    roles: ['msa-columns', 'msa-entries', 'msa-fasta-aa', 'msa-fasta-3di'],
    requires: ['msa-columns', 'msa-entries'],
    options: ['top'],

    async run(context) {
        const roster = loadEntries(context);
        const columns = await loadColumns(context, roster);
        const alphabet = rolePresent(context, 'msa-fasta-aa')
            ? 'msa-fasta-aa'
            : (rolePresent(context, 'msa-fasta-3di') ? 'msa-fasta-3di' : null);
        const rows = alphabet === null ? null : await loadAligned(context, alphabet, roster);
        const observations = columns.map(column => {
            const carriers = rows === null ? null : carriersOf(column, rows, roster);
            return { column, carriers, signature: carriers === null ? String(column.nonGapCount) : carriers.join('\u0000') };
        });

        const runs = [];
        for (const observation of observations) {
            const last = runs[runs.length - 1] ?? null;
            if (last !== null && last.signature === observation.signature
                && observation.column.column === last.to + 1) {
                last.to = observation.column.column;
                last.columns.push(observation.column);
                continue;
            }
            runs.push({
                signature: observation.signature,
                from: observation.column.column,
                to: observation.column.column,
                columns: [observation.column],
                carriers: observation.carriers,
            });
        }

        const built = runs.map(run => {
            const occupancies = run.columns.map(column => column.occupancy);
            return {
                from: run.from,
                to: run.to,
                oneBased: `${run.from + 1}-${run.to + 1}`,
                length: run.columns.length,
                nonGapCount: run.columns[0].nonGapCount,
                occupancyMin: round(Math.min(...occupancies), 4),
                occupancyMean: round(occupancies.reduce((sum, value) => sum + value, 0) / occupancies.length, 4),
                occupancyMax: round(Math.max(...occupancies), 4),
                carriers: run.carriers,
            };
        });

        for (const block of built.filter(block => block.nonGapCount === 1)) {
            context.warnings.add('SINGLE_MEMBER_SUPPORT', { scope: { kind: 'block' }, id: block.oneBased });
        }

        const cap = displayCap(context, LISTED);
        const summary = {
            entries: roster.count,
            columns: columns.length,
            blockCount: built.length,
            blocks: [...built].sort((a, b) => b.length - a.length || a.from - b.from).slice(0, cap)
                .map(({ carriers, ...block }) => block),
            carriersFrom: alphabet,
            degraded: degradedRoles(context, OPTIONAL),
            grouping: rows === null ? 'equal non-gap count' : 'identical carrier set',
        };

        return { summary, tables: { blocks: table(built) } };
    },
};

function carriersOf(column, rows, roster) {
    return roster.entries.filter(entry => {
        const row = rows.get(entry.name);
        return row[column.column] !== undefined && row[column.column] !== GAP;
    }).map(entry => entry.name);
}

const table = blocks => ({
    header: ['from', 'to', 'oneBased', 'length', 'nonGapCount', 'occupancyMin', 'occupancyMean',
        'occupancyMax', 'carriers'],
    rows: blocks.map(block => ({ ...block, carriers: (block.carriers ?? []).join('; ') })),
});
