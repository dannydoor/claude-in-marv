// Shared row reading and arithmetic for the hit modules.

import { readJsonl } from '../io/streams.mjs';
import { confineExisting } from '../io/paths.mjs';
import { fail } from '../io/errors.mjs';

// Confine every hit-role file before parsing rows.
export async function forEachRow(root, unit, visit) {
    if (unit.path === null) return 0;
    const file = confineExisting(root, unit.path);
    let seen = 0;
    for await (const row of readJsonl(file, { label: unit.path })) {
        seen += 1;
        visit(row, seen);
    }
    return seen;
}

// Preserve server-written row ids instead of deriving them from indices.
export const rowId = row => row.id;

// Round only at the output boundary.
export function round(value, places) {
    if (!Number.isFinite(value)) return null;
    const out = Number(value.toFixed(places));
    return out === 0 ? 0 : out;
}

export const ascending = values => [...values].sort((a, b) => a - b);

// The order statistic at `p`, taken by flooring rather than interpolating.
export const quantileOf = (sortedAsc, p) =>
    (sortedAsc.length === 0 ? null : sortedAsc[Math.floor((sortedAsc.length - 1) * p)]);

// Reported as an ordered list rather than an object keyed by the fraction.
export function quantileSet(values, fractions) {
    const sorted = ascending(values.filter(Number.isFinite));
    return { n: sorted.length, at: fractions.map(p => ({ q: p, value: quantileOf(sorted, p) })) };
}

// Compute query coverage from inclusive 1-based positions.
export function queryCoverage(row) {
    const length = row.qLen;
    if (!Number.isFinite(length) || length <= 0) return null;
    const span = row.qEndPos - row.qStartPos + 1;
    if (!Number.isFinite(span)) return null;
    return span / length;
}

// Read grouped chain alignments and monomer rows through one shape.
const isAlignment = entry => entry !== null && typeof entry === 'object' && !Array.isArray(entry);

// Returns the alignments AND what was dropped getting them.
export const alignments = row => {
    if (!Array.isArray(row.chains)) return { entries: [row], excluded: 0 };
    const nested = row.chains.filter(isAlignment);
    const excluded = row.chains.length - nested.length;
    return nested.length > 0 ? { entries: nested, excluded } : { entries: [row], excluded };
};

// Group alignment rows by query identity and length.
export const queryOf = alignment => alignment.query ?? null;

// Define the complete ranking-direction domain.
export const DIRECTIONS = Object.freeze(['higher', 'lower']);
export const usableDirection = direction => DIRECTIONS.includes(direction);

// Best-first, by the direction the server declared.
export const better = (direction, a, b) => {
    if (!usableDirection(direction)) {
        fail('MANIFEST_UNREADABLE', { reason: 'no usable ranking direction', direction: direction ?? null });
    }
    return direction === 'lower' ? a < b : a > b;
};

export function bestValue(values, direction) {
    let best = null;
    for (const value of values) {
        if (!Number.isFinite(value)) continue;
        if (best === null || better(direction, value, best)) best = value;
    }
    return best;
}
