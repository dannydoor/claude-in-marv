// Read shared FoldMason data while keeping columns, residues and occupancy distinct.

import { readJsonl, readFasta, readGzipJson, readJson } from '../io/streams.mjs';
import { confineExisting } from '../io/paths.mjs';
import { fail } from '../io/errors.mjs';
// Reuse the package-wide quantile rule.
import { round, ascending, quantileOf } from '../hit/rows.mjs';

export { round, ascending, quantileOf };

// Bound artifact-sized allocations.
export const BOUND = Object.freeze({
    entries: 4096,
    columns: 500000,
    residues: 500000,
    letters: 64,
});

// The conservation scale is fixed and alignment-independent.
export const CONSERVATION_MAX = 11;

// Fixed arithmetic constants do not classify results.
export const MEDIAN = 0.5;

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
const isFractionValue = value => isFiniteNumber(value) && value >= 0 && value <= 1;
const isCount = (value, ceiling) => Number.isInteger(value) && value >= 0 && value <= ceiling;

const unitOf = (context, role) => {
    const resolved = context.roles[role];
    if (!resolved || resolved.present !== true) return null;
    return resolved.units[0] ?? null;
};

export const rolePresent = (context, role) => unitOf(context, role) !== null;

// Which optional roles this run did NOT get.
export function degradedRoles(context, optional) {
    return optional.filter(role => !rolePresent(context, role)).sort();
}

const fileOf = (context, role) => {
    const unit = unitOf(context, role);
    if (unit === null) fail('REQUIRED_ROLE_MISSING', { role });
    return { path: unit.path, resolved: confineExisting(context.root, unit.path) };
};

// entries

// Index aligned structures by name.
export function loadEntries(context) {
    const { path, resolved } = fileOf(context, 'msa-entries');
    const doc = readJson(resolved, { label: path });
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
        fail('PARSE_FAILED', { file: path, reason: 'not an object' });
    }
    if (!Array.isArray(doc.entries)) fail('PARSE_FAILED', { file: path, reason: 'no entries array' });
    if (!isCount(doc.totalEntries, BOUND.entries) || doc.totalEntries < 1) {
        fail('PARSE_FAILED', { file: path, reason: 'totalEntries is not an entry count' });
    }
    if (doc.entries.length !== doc.totalEntries) {
        fail('PARSE_FAILED', { file: path, reason: 'totalEntries disagrees with the roster length' });
    }
    if (!isCount(doc.columns, BOUND.columns) || doc.columns < 1) {
        fail('PARSE_FAILED', { file: path, reason: 'columns is not a column count' });
    }
    const entries = doc.entries.map((entry, position) => {
        if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string' || entry.name === '') {
            fail('PARSE_FAILED', { file: path, reason: 'an entry has no name' });
        }
        if (!isCount(entry.residueCount, BOUND.residues)) {
            fail('PARSE_FAILED', { file: path, reason: 'an entry has no residue count' });
        }
        return {
            index: Number.isInteger(entry.index) ? entry.index : position,
            name: entry.name,
            residueCount: entry.residueCount,
            alignedLength: Number.isInteger(entry.alignedLength) ? entry.alignedLength : doc.columns,
        };
    });
    if (new Set(entries.map(e => e.name)).size !== entries.length) {
        fail('PARSE_FAILED', { file: path, reason: 'a name is repeated' });
    }
    return { entries, count: entries.length, columns: doc.columns };
}

// columns

// One record per alignment column, streamed.
export async function loadColumns(context, roster) {
    const { path, resolved } = fileOf(context, 'msa-columns');
    const columns = [];
    const excluded = new Map();
    const note = (reason, column) => {
        if (!excluded.has(reason)) excluded.set(reason, []);
        excluded.get(reason).push(column);
    };

    let seen = 0;
    for await (const row of readJsonl(resolved, { label: path })) {
        if (columns.length >= BOUND.columns) { note('beyond the column ceiling', seen); seen += 1; continue; }
        const index = Number.isInteger(row.column) && row.column >= 0 ? row.column : seen;
        seen += 1;

        const conservation = (row.conservation !== null && typeof row.conservation === 'object') ? row.conservation : {};
        const consensus = (row.consensus !== null && typeof row.consensus === 'object') ? row.consensus : {};

        // Column depth is the entry-bounded non-gap count.
        let nonGapCount = consensus.nonGapCount;
        if (!isCount(nonGapCount, roster.count)) { note('the non-gap count is not a member count', index); nonGapCount = null; }
        let occupancy = row.occupancy;
        if (!isFractionValue(occupancy)) { note('occupancy is outside 0-1', index); occupancy = null; }
        let score = conservation.score;
        if (!isCount(score, CONSERVATION_MAX)) { note('the conservation score is off its scale', index); score = null; }
        if (nonGapCount === null || occupancy === null) continue;

        const letters = Array.isArray(consensus.letters)
            ? consensus.letters.slice(0, BOUND.letters)
                .filter(l => l !== null && typeof l === 'object' && typeof l.glyph === 'string')
                .map(l => ({
                    glyph: l.glyph,
                    count: isCount(l.count, roster.count) ? l.count : null,
                    logoFraction: isFractionValue(l.logoFraction) ? l.logoFraction : null,
                }))
            : [];

        columns.push({
            column: index,
            oneBased: index + 1,
            occupancy,
            nonGapCount,
            score,
            glyph: typeof consensus.glyph === 'string' ? consensus.glyph : '',
            modalFraction: isFractionValue(consensus.modalFractionNonGap) ? consensus.modalFractionNonGap : null,
            letters,
            lddt: isFiniteNumber(row.lddt) ? row.lddt : null,
            entropy: isFiniteNumber(row.entropy) ? row.entropy : null,
            positive: Array.isArray(conservation.positive) ? conservation.positive.filter(p => typeof p === 'string') : [],
            negative: Array.isArray(conservation.negative) ? conservation.negative.filter(p => typeof p === 'string') : [],
            isIdentity: conservation.isIdentity === true,
            isFullyConserved: conservation.isFullyConserved === true,
        });
    }

    for (const [reason, affected] of [...excluded.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        for (const column of affected) context.warnings.add('INTEGRITY_ISSUE', { scope: { reason }, id: column });
    }
    if (columns.length === 0) fail('PARSE_FAILED', { file: path, reason: 'no usable column' });
    return columns;
}

// sequences

export const GAP = '-';

// Aligned sequences by entry name.
export async function loadAligned(context, role, roster) {
    const { path, resolved } = fileOf(context, role);
    const sequences = new Map();
    for await (const record of readFasta(resolved, { label: path })) {
        if (sequences.size >= BOUND.entries) break;
        if (sequences.has(record.name)) {
            fail('PARSE_FAILED', { file: path, reason: 'an entry name is repeated' });
        }
        sequences.set(record.name, record.sequence);
    }
    if ([...sequences.values()].some(sequence => sequence.length !== roster.columns)) {
        fail('PARSE_FAILED', { file: path, reason: 'an aligned row width disagrees with the roster' });
    }
    if (roster.entries.some(e => !sequences.has(e.name))) {
        fail('PARSE_FAILED', { file: path, reason: 'an entry of the roster has no aligned row' });
    }
    return sequences;
}

// Identity over the positions where BOTH rows carry a residue.
export function pairIdentity(a, b) {
    let both = 0;
    let same = 0;
    const width = Math.min(a.length, b.length);
    for (let i = 0; i < width; i += 1) {
        if (a[i] === GAP || b[i] === GAP) continue;
        both += 1;
        if (a[i] === b[i]) same += 1;
    }
    return both === 0 ? { identity: 0, overlap: 0 } : { identity: same / both, overlap: both };
}

const pairKey = (a, b) => `${a} ${b}`;

// Enumerate unordered pairs in roster order for deterministic output.
export function identityMatrix(roster, sequences) {
    const names = roster.entries.map(e => e.name);
    const m = new Map();
    const values = [];
    for (let i = 0; i < names.length; i += 1) {
        m.set(pairKey(names[i], names[i]), 1);
        for (let j = i + 1; j < names.length; j += 1) {
            const { identity } = pairIdentity(sequences.get(names[i]), sequences.get(names[j]));
            m.set(pairKey(names[i], names[j]), identity);
            m.set(pairKey(names[j], names[i]), identity);
            values.push(identity);
        }
    }
    return { names, at: (a, b) => m.get(pairKey(a, b)) ?? 0, values: ascending(values) };
}

// residue map

// Resolve columns to residues only through this map.
export async function loadResidueMap(context, roster) {
    const { path, resolved } = fileOf(context, 'msa-residue-map');
    const byName = new Map();
    for await (const row of readJsonl(resolved, { label: path })) {
        if (byName.size >= BOUND.entries) break;
        const name = typeof row.entryName === 'string' ? row.entryName : null;
        if (name === null) fail('PARSE_FAILED', { file: path, reason: 'a residue map row has no entry name' });
        const entry = roster.entries.find(e => e.name === name) ?? null;
        if (entry === null) fail('PARSE_FAILED', { file: path, reason: 'the residue map names an entry the roster does not' });
        const occupied = expandRanges(row.occupiedColumns, path);
        if (occupied.length !== entry.residueCount) {
            fail('PARSE_FAILED', { file: path, reason: 'the occupied columns do not number the residues of that entry' });
        }
        const toResidue = new Map();
        occupied.forEach((column, residue) => toResidue.set(column, residue));
        byName.set(name, {
            name,
            residueCount: entry.residueCount,
            occupied,
            residueOf: column => (toResidue.has(column) ? toResidue.get(column) : null),
            tokens: Array.isArray(row.tokens) ? row.tokens.slice(0, BOUND.residues).map(String) : [],
        });
    }
    if (roster.entries.some(e => !byName.has(e.name))) {
        fail('PARSE_FAILED', { file: path, reason: 'an entry of the roster has no residue map' });
    }
    return byName;
}

function expandRanges(ranges, file) {
    if (!Array.isArray(ranges)) fail('PARSE_FAILED', { file, reason: 'occupiedColumns is not an array' });
    const out = [];
    for (const range of ranges) {
        if (typeof range !== 'string') fail('PARSE_FAILED', { file, reason: 'a column range is not a string' });
        const match = /^(\d+)(?:-(\d+))?$/.exec(range.trim());
        if (match === null) fail('PARSE_FAILED', { file, reason: 'a column range is not a range' });
        const from = Number(match[1]);
        const to = match[2] === undefined ? from : Number(match[2]);
        if (to < from || to >= BOUND.columns) {
            fail('PARSE_FAILED', { file, reason: 'a column range is not ordered or is beyond the ceiling' });
        }
        for (let column = from; column <= to; column += 1) {
            if (out.length >= BOUND.residues) fail('PARSE_FAILED', { file, reason: 'more occupied columns than the residue ceiling' });
            out.push(column);
        }
    }
    return out;
}

// coordinates

// Ca coordinates, one triple per RESIDUE.
export function loadCoordinates(context, roster) {
    const { path, resolved } = fileOf(context, 'msa-coordinates');
    const doc = readGzipJson(resolved, { label: path });
    if (doc === null || typeof doc !== 'object' || !Array.isArray(doc.entries)) {
        fail('PARSE_FAILED', { file: path, reason: 'no entries array' });
    }
    const byName = new Map();
    for (const record of doc.entries.slice(0, BOUND.entries)) {
        if (record === null || typeof record !== 'object' || typeof record.name !== 'string') continue;
        const entry = roster.entries.find(e => e.name === record.name) ?? null;
        if (entry === null) continue;
        const triples = parseTriples(record.ca, entry.residueCount);
        if (triples === null) {
            // The claim a geometric figure would rest on is the one that cannot be made.
            context.warnings.add('COORDINATE_COUNT_MISMATCH', {
                scope: { entryName: entry.name }, id: entry.name, facts: { residueCount: entry.residueCount },
            });
            continue;
        }
        byName.set(entry.name, { name: entry.name, residueCount: entry.residueCount, ca: triples });
    }
    return byName;
}

function parseTriples(ca, residueCount) {
    if (typeof ca !== 'string' || ca === '') return null;
    const parts = ca.split(',');
    if (parts.length !== residueCount * 3) return null;
    const out = new Float64Array(parts.length);
    for (let i = 0; i < parts.length; i += 1) {
        const value = Number(parts[i]);
        if (!Number.isFinite(value)) return null;
        out[i] = value;
    }
    return out;
}

export const caOf = (coordinates, residue) => ({
    x: coordinates.ca[residue * 3],
    y: coordinates.ca[residue * 3 + 1],
    z: coordinates.ca[residue * 3 + 2],
});

export const distance = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

// Apply display caps only after all calculations.
export const displayCap = (context, fallback) =>
    (context.top === null || context.top === undefined ? fallback : context.top);
