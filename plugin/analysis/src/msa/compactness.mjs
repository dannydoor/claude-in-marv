// Report pairwise C-alpha distances for candidate columns after resolving them to residues.

import {
    loadEntries, loadResidueMap, loadCoordinates,
    caOf, distance, round, ascending, quantileOf, MEDIAN,
} from './alignment.mjs';
import { namedReference, requestedColumns } from './motif-input.mjs';

const MIN_RESIDUES_FOR_SPREAD = 2;

export const compactness = {
    name: 'msa/compactness',
    version: 1,
    roles: ['msa-coordinates', 'msa-residue-map', 'msa-entries'],
    requires: ['msa-coordinates', 'msa-residue-map', 'msa-entries'],
    options: ['columns', 'reference'],

    async run(context) {
        const roster = loadEntries(context);
        const reference = namedReference(context, roster);
        const requested = requestedColumns(context, roster);
        const residueMap = await loadResidueMap(context, roster);
        const coordinates = loadCoordinates(context, roster);

        const map = residueMap.get(reference.name);
        const coords = coordinates.get(reference.name) ?? null;
        if (coords === null) {
            // The reference has no usable coordinates, so there is no geometry to report.
            return {
                summary: {
                    entryName: reference.name,
                    columnsRequested: requested,
                    residues: [],
                    resolved: 0,
                    pairwiseMaxA: null,
                    pairwiseMedianA: null,
                    residueSpread: [],
                    claimLimit: 'Ca geometry only: no side-chain, ligand, metal, or functional-site inference',
                },
                tables: { pairwise: { header: ['a', 'b', 'distanceA'], rows: [] } },
            };
        }

        const residues = [];
        const missing = [];
        for (const column of requested) {
            const residue = map.residueOf(column);
            if (residue === null) { missing.push(column); continue; }
            residues.push({ column, oneBased: column + 1, residue, point: caOf(coords, residue) });
        }
        if (missing.length > 0) {
            for (const column of missing) {
                context.warnings.add('REFERENCE_RESIDUE_ABSENT', {
                    scope: { entryName: reference.name }, id: column,
                });
            }
        }

        const pairs = [];
        for (let i = 0; i < residues.length; i += 1) {
            for (let j = i + 1; j < residues.length; j += 1) {
                pairs.push({
                    a: residues[i].oneBased,
                    b: residues[j].oneBased,
                    distanceA: round(distance(residues[i].point, residues[j].point), 3),
                });
            }
        }

        const values = ascending(pairs.map(pair => pair.distanceA));
        const maxA = values.length === 0 ? null : values[values.length - 1];

        const residueSpread = residues.length < MIN_RESIDUES_FOR_SPREAD ? [] : residues.map(residue => {
            const worst = Math.max(...residues.filter(other => other !== residue)
                .map(other => distance(residue.point, other.point)));
            return { oneBased: residue.oneBased, column: residue.column, maxToOthersA: round(worst, 3) };
        }).sort((a, b) => b.maxToOthersA - a.maxToOthersA || a.column - b.column);

        const summary = {
            entryName: reference.name,
            columnsRequested: requested,
            residues: residues.map(({ column, oneBased, residue }) => ({ column, oneBased, residueIndex: residue })),
            resolved: residues.length,
            unresolvedColumns: missing,
            pairwiseMaxA: maxA,
            pairwiseMedianA: values.length === 0 ? null : round(quantileOf(values, MEDIAN), 3),
            residueSpread,
            claimLimit: 'Ca geometry only: no side-chain, ligand, metal, or functional-site inference',
        };

        return { summary, tables: { pairwise: { header: ['a', 'b', 'distanceA'], rows: pairs } } };
    },
};
