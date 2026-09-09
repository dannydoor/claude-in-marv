// The two inputs the motif-building subcommands share: which MSA row, and which columns.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { refuse } from '../cli/args.mjs';
import { BOUND } from './alignment.mjs';

// Refuse a numeric entry name that could be a query index.
const LOOKS_POSITIONAL = /^\d+$/;

const namedRosterEntry = (context, roster, flag, label) => {
    const wanted = context.args.get(flag) ?? null;
    if (wanted === null) {
        refuse(`this subcommand needs the ${label}, by name`, {
            flag: `--${flag}`, entries: roster.entries.map(entry => entry.name),
        });
    }
    if (LOOKS_POSITIONAL.test(wanted)) {
        refuse('flag takes an entry NAME, not a row number or a query index', {
            flag: `--${flag}`, value: wanted, entries: roster.entries.map(entry => entry.name),
        });
    }
    const found = roster.entries.find(entry => entry.name === wanted) ?? null;
    if (found === null) {
        refuse('this alignment carries no entry of that name', {
            flag: `--${flag}`, value: wanted, entries: roster.entries.map(entry => entry.name),
        });
    }
    return found;
};

export const namedEntry = (context, roster) => namedRosterEntry(context, roster, 'entry', 'reference entry');
export const namedReference = (context, roster) => namedRosterEntry(context, roster, 'reference', 'geometry reference');

// Preserve the requested order of 0-based columns.
export function requestedColumns(context, roster) {
    const raw = context.args.get('columns') ?? null;
    if (raw === null) refuse('this subcommand needs the candidate columns', { flag: '--columns' });
    const parts = raw.split(',').map(part => part.trim()).filter(part => part !== '');
    if (parts.length === 0) refuse('flag takes a comma list of 0-based column indices', { flag: '--columns', value: raw });
    const out = [];
    for (const part of parts) {
        if (!/^\d+$/.test(part)) refuse('a column is not a non-negative integer', { flag: '--columns', value: part });
        const column = Number(part);
        if (column >= roster.columns) {
            refuse('this alignment has no such column', { flag: '--columns', value: column, columns: roster.columns });
        }
        if (out.includes(column)) refuse('a column was given twice', { flag: '--columns', value: column });
        out.push(column);
    }
    return out;
}

// the caller-supplied structure

// Read the caller-supplied deposited structure.
const readingStructure = (pathname, operation, act) => {
    try {
        return act();
    } catch (cause) {
        refuse('the structure file cannot be read', {
            flag: '--structure', operation, reason: cause?.code ?? 'unusable',
            // The path is echoed because the CALLER wrote it on their own command line.
            value: pathname,
        });
    }
};

// PDB coordinate format.
const DIGEST_CHARS = 16;

// The PDB coordinate record's own column spans.
const PDB = Object.freeze({
    record: [0, 6], altloc: [16, 17], atomName: [12, 16], residueName: [17, 20],
    chain: [21, 22], sequenceNumber: [22, 26], insertionCode: [26, 27],
});
const field = (line, span) => line.slice(span[0], span[1]).trim();

const THREE_TO_ONE = Object.freeze({
    ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H',
    ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W',
    TYR: 'Y', VAL: 'V', SEC: 'U', PYL: 'O', MSE: 'M',
});

export function readStructureChains(context) {
    const pathname = context.args.get('structure') ?? null;
    if (pathname === null) refuse('this subcommand needs a deposited structure file', { flag: '--structure' });

    const text = readingStructure(pathname, 'read', () => fs.readFileSync(pathname, 'utf8'));
    // Record structure content, never its host path.
    const digest = crypto.createHash('sha256').update(text).digest('hex').slice(0, DIGEST_CHARS);

    const chains = new Map();
    let dropped = 0;
    let truncated = false;
    for (const line of text.split('\n')) {
        const record = field(line, PDB.record);
        if (record !== 'ATOM' && record !== 'HETATM') continue;
        if (field(line, PDB.atomName) !== 'CA') continue;
        const one = THREE_TO_ONE[field(line, PDB.residueName).toUpperCase()] ?? null;
        if (one === null) continue;
        const chain = field(line, PDB.chain) || ' ';
        const number = Number(field(line, PDB.sequenceNumber));
        if (!Number.isInteger(number)) continue;
        const insertionCode = field(line, PDB.insertionCode);
        const altloc = field(line, PDB.altloc);

        if (!chains.has(chain)) chains.set(chain, { chain, residues: [], seen: new Set() });
        const held = chains.get(chain);
        // Altloc dedupe: one residue, one CA.
        const key = `${number}|${insertionCode}`;
        if (held.seen.has(key)) { dropped += 1; continue; }
        // Apply the artifact-size ceiling to caller-supplied coordinates.
        if (held.residues.length >= BOUND.residues) { truncated = true; continue; }
        held.seen.add(key);
        held.residues.push({ authorNumber: number, insertionCode, residue: one, altloc });
    }

    if (chains.size === 0) {
        refuse('no PDB-format CA record was found in that file', {
            flag: '--structure', value: pathname,
            detail: 'this subcommand reads PDB coordinate records; mmCIF is not parsed',
        });
    }
    return {
        path: pathname,
        digest,
        altlocDropped: dropped,
        truncated,
        chains: [...chains.values()].map(({ chain, residues }) => ({
            chain,
            residues,
            sequence: residues.map(residue => residue.residue).join(''),
        })),
    };
}
