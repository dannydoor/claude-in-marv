// Map selected alignment columns across every member without inferring function.

import { loadEntries, loadAligned, loadResidueMap, GAP } from './alignment.mjs';
import { requestedColumns } from './motif-input.mjs';

export const columnResidues = {
    name: 'msa/column-residues',
    version: 1,
    roles: ['msa-entries', 'msa-fasta-aa', 'msa-residue-map'],
    requires: ['msa-entries', 'msa-fasta-aa', 'msa-residue-map'],
    options: ['columns'],

    async run(context) {
        const roster = loadEntries(context);
        const requested = requestedColumns(context, roster);
        const sequences = await loadAligned(context, 'msa-fasta-aa', roster);
        const residueMaps = await loadResidueMap(context, roster);
        const rows = [];

        for (const column of requested) {
            for (const entry of roster.entries) {
                const glyph = sequences.get(entry.name)[column];
                const map = residueMaps.get(entry.name);
                const residueIndex = map.residueOf(column);
                rows.push({
                    column,
                    oneBased: column + 1,
                    entryIndex: entry.index,
                    entryName: entry.name,
                    glyph,
                    gap: glyph === GAP,
                    residueIndex: residueIndex ?? '',
                    label: residueIndex === null ? '' : (map.tokens[residueIndex] ?? ''),
                });
            }
        }

        context.selectors = { columns: requested };
        return {
            summary: {
                columnsRequested: requested,
                entries: roster.count,
                rows: rows.length,
                claimLimit: 'alignment glyphs and modelled residue mappings only; no functional site or inclusion decision is made',
            },
            tables: {
                'column-residues': {
                    header: ['column', 'oneBased', 'entryIndex', 'entryName', 'glyph', 'gap', 'residueIndex', 'label'],
                    rows,
                },
            },
        };
    },
};
