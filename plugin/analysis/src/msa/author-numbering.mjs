// Map selected alignment columns to author residue numbers in a caller-supplied PDB.

import { loadEntries, loadResidueMap, loadAligned, round } from './alignment.mjs';
import { refuse } from '../cli/args.mjs';
import { namedEntry, requestedColumns, readStructureChains } from './motif-input.mjs';

export const authorNumbering = {
    name: 'msa/author-numbering',
    version: 1,
    roles: ['msa-residue-map', 'msa-entries', 'msa-fasta-aa'],
    requires: ['msa-residue-map', 'msa-entries', 'msa-fasta-aa'],
    options: ['columns', 'entry', 'structure'],

    async run(context) {
        const roster = loadEntries(context);
        const reference = namedEntry(context, roster);
        const requested = requestedColumns(context, roster);
        const residueMap = await loadResidueMap(context, roster);
        const rowSequence = (await loadAligned(context, 'msa-fasta-aa', roster)).get(reference.name) ?? null;
        if (rowSequence === null) {
            refuse('this alignment carries no amino-acid row for that entry', {
                flag: '--entry', value: reference.name,
            });
        }
        const rowResidues = rowSequence.replace(/-/g, '');
        const map = residueMap.get(reference.name);

        const structure = readStructureChains(context);
        const frame = frameFor(structure, reference, rowResidues);

        const offsets = runsOf(frame.chain.residues);
        const mapped = requested.map(column => {
            const residueIndex = map.residueOf(column);
            if (residueIndex === null) {
                return {
                    column, oneBased: column + 1, residueIndex: null, label: null,
                    authorNumber: null, insertionCode: null, residue: null, rowGlyph: null, agrees: null,
                };
            }
            const deposited = frame.chain.residues[residueIndex];
            return {
                column,
                oneBased: column + 1,
                residueIndex,
                // The FoldMason label: 1-based over the modelled residues.
                label: residueIndex + 1,
                authorNumber: deposited.authorNumber,
                insertionCode: deposited.insertionCode,
                residue: deposited.residue,
                rowGlyph: rowResidues[residueIndex],
                agrees: deposited.residue === rowResidues[residueIndex],
            };
        });

        const absent = mapped.filter(entry => entry.residueIndex === null);
        for (const entry of absent) {
            // Blocking: the caller asked about a column this entry does not occupy.
            context.warnings.add('REFERENCE_RESIDUE_ABSENT', {
                scope: { entryName: reference.name }, id: entry.column,
            });
        }
        if (structure.altlocDropped > 0) {
            context.warnings.add('INTEGRITY_ISSUE', {
                scope: { reason: 'alternate conformations of one residue were collapsed to one CA' },
                facts: { altlocDropped: structure.altlocDropped },
            });
        }

        const summary = {
            entryName: reference.name,
            entryIndex: reference.index,
            columnsRequested: requested,
            structure: {
                digest: structure.digest,
                chain: frame.chain.chain,
                chainsMatching: frame.chainsMatching,
                residues: frame.chain.residues.length,
                altlocDropped: structure.altlocDropped,
                firstAuthorNumber: frame.chain.residues[0].authorNumber,
                lastAuthorNumber: frame.chain.residues[frame.chain.residues.length - 1].authorNumber,
                contiguous: offsets.length === 1 && frame.anyInsertionCodes === false,
                anyInsertionCodes: frame.anyInsertionCodes,
            },
            frame: {
                offset: offsets.length === 1 ? offsets[0].offset : null,
                offsetIsConstant: offsets.length === 1,
                offsetsSeen: [...new Set(offsets.map(run => run.offset))].sort((a, b) => a - b),
                nDistinctOffsets: new Set(offsets.map(run => run.offset)).size,
            },
            offsets,
            mapped,
            sequenceAgreement: {
                compared: rowResidues.length,
                matches: frame.matches,
                fraction: round(frame.matches / rowResidues.length, 4),
                identical: true,
                mismatches: 0,
                firstMismatch: null,
            },
            unresolvedColumns: absent.map(entry => entry.column),
            claimLimit: 'a sequence disagreement is a structured error, never a weak result: this frame is reported only because the row and the chain are the same molecule',
        };

        context.selectors = {
            entry: reference.name,
            columns: requested,
            // Record deposit content, never its host path.
            structure: structure.digest,
        };

        return { summary, tables: { numbering: tableOf(mapped, reference, frame) } };
    },
};

// Find the chain whose residues match the alignment row.
function frameFor(structure, reference, rowResidues) {
    const sameLength = structure.chains.filter(chain => chain.residues.length === rowResidues.length);
    const matching = sameLength.filter(chain => chain.sequence === rowResidues);
    if (matching.length === 0) {
        const best = sameLength[0] ?? structure.chains[0];
        let firstMismatch = null;
        for (let i = 0; i < Math.min(best.sequence.length, rowResidues.length); i += 1) {
            if (best.sequence[i] !== rowResidues[i]) {
                firstMismatch = {
                    residueIndex: i, label: i + 1,
                    authorNumber: best.residues[i]?.authorNumber ?? null,
                    inRow: rowResidues[i], inStructure: best.sequence[i],
                };
                break;
            }
        }
        // Refused, not graded. A frame computed here would number a different molecule.
        refuse('the structure does not carry this entry\'s residues, so no numbering frame exists', {
            flag: '--structure',
            entryName: reference.name,
            rowResidues: rowResidues.length,
            chainsTried: structure.chains.map(chain => ({ chain: chain.chain, residues: chain.residues.length })),
            firstMismatch,
        });
    }
    const chain = matching[0];
    return {
        chain,
        // Record equivalent homomer chains without refusing.
        chainsMatching: matching.map(candidate => candidate.chain),
        matches: rowResidues.length,
        anyInsertionCodes: chain.residues.some(residue => residue.insertionCode !== ''),
    };
}

// Preserve author-numbering gaps as constant-offset runs.
function runsOf(residues) {
    const out = [];
    residues.forEach((residue, index) => {
        const offset = residue.authorNumber - (index + 1);
        const last = out[out.length - 1] ?? null;
        if (last !== null && last.offset === offset) {
            last.toResidue = index;
            last.toLabel = index + 1;
            last.toAuthorNumber = residue.authorNumber;
            last.residues += 1;
            return;
        }
        out.push({
            offset,
            fromResidue: index, toResidue: index,
            fromLabel: index + 1, toLabel: index + 1,
            fromAuthorNumber: residue.authorNumber, toAuthorNumber: residue.authorNumber,
            residues: 1,
        });
    });
    return out;
}

function tableOf(mapped, reference, frame) {
    const header = ['column', 'oneBased', 'entryName', 'chain', 'residueIndex', 'label',
        'authorNumber', 'insertionCode', 'residue', 'rowGlyph', 'agrees'];
    const rows = mapped.map(entry => ({
        column: entry.column,
        oneBased: entry.oneBased,
        entryName: reference.name,
        chain: frame.chain.chain,
        residueIndex: entry.residueIndex ?? '',
        label: entry.label ?? '',
        authorNumber: entry.authorNumber ?? '',
        insertionCode: entry.insertionCode ?? '',
        residue: entry.residue ?? '',
        rowGlyph: entry.rowGlyph ?? '',
        agrees: entry.agrees === null ? '' : entry.agrees,
    }));
    return { header, rows };
}
