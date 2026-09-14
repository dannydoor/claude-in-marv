import { fail } from './errors.mjs';

// Runtime warning vocabulary.
export const WARNING_LEVELS = Object.freeze({
    DATABASE_ERROR: 'blocking',
    SATURATED_ROWS: 'caution',
    ZERO_HIT_DATABASE: 'note',
    NO_TAXONOMY_TREE: 'caution',
    LOW_TAXONOMY_COVERAGE: 'caution',
    MISSING_DESCRIPTIONS: 'note',
    CROSS_DATABASE_INCOMPARABLE: 'caution',
    MISSING_COLUMN_METRIC: 'note',
    SINGLE_MEMBER_SUPPORT: 'note',
    REFERENCE_RESIDUE_ABSENT: 'blocking',
    PATTERN_WIDTH_MISMATCH: 'blocking',
    COORDINATE_COUNT_MISMATCH: 'blocking',
    QUERY_RESIDUES_UNAVAILABLE: 'caution',
    DATABASE_SET_UNKNOWN: 'caution',
    NO_COMMON_DATABASE: 'blocking',
    INTEGRITY_ISSUE: 'caution',
});

// Part of the output contract, not a tuning knob: how many affected ids stay inline.
const DEFAULT_SAMPLE = 5;

// The table's path relative to the run directory, named once.
export const AFFECTED_TABLE = 'tables/warnings.tsv';

// facts holds only values observed in this run.
const RESERVED = new Set(['message', 'remedy', 'advice', 'fix', 'suggestion', 'level', 'code']);

// Codepoint order, not locale collation: `localeCompare` depends on the host's ICU locale.
const byCodepoint = (a, b) => {
    const x = String(a);
    const y = String(b);
    return x < y ? -1 : x > y ? 1 : 0;
};

const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).sort((a, b) => byCodepoint(a[0], b[0]))
            .map(([k, v]) => [k, canonical(v)]));
    }
    return value;
};

// Content, not key order: one logical scope is one group however the caller spelled it.
const scopeKey = scope => (scope === null || scope === undefined ? '' : JSON.stringify(canonical(scope)));

const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// Canonicalize nested keys before deterministic serialization.

export class Warnings {
    constructor({ sample = DEFAULT_SAMPLE } = {}) {
        this.sample = sample;
        this.groups = new Map();
        this.order = [];
    }

    // Aggregate one warning call per affected item.
    add(code, { scope = null, id = null, facts = {} } = {}) {
        if (!(code in WARNING_LEVELS)) fail('INVALID_ANALYSIS', { reason: 'unknown warning code', code });
        const key = code + ' ' + scopeKey(scope);
        if (!this.groups.has(key)) {
            this.groups.set(key, { code, scope, count: 0, ids: [], facts: {} });
            this.order.push(key);
        }
        const group = this.groups.get(key);
        group.count += 1;
        if (id !== null) group.ids.push(id);
        // Refuse conflicting facts within one warning group.
        for (const [name, value] of Object.entries(facts)) {
            if (RESERVED.has(name)) {
                fail('INVALID_ANALYSIS', { reason: 'a fact carries advice, not an observation', code, fact: name });
            }
            if (Object.hasOwn(group.facts, name) && !same(group.facts[name], value)) {
                fail('INVALID_ANALYSIS', { reason: 'a warning fact was redefined', code, fact: name });
            }
            group.facts[name] = value;
        }
        return this;
    }

    // Sort by code and scope for deterministic output.
    toJSON() {
        return this.order
            .map(k => this.groups.get(k))
            .sort((a, b) => byCodepoint(a.code, b.code) || byCodepoint(scopeKey(a.scope), scopeKey(b.scope)))
            .map(g => {
                // The sample is drawn from the sorted id set, not from arrival order.
                const sample = [...g.ids].sort(byCodepoint).slice(0, this.sample);
                const facts = { count: g.count, ...canonical(g.facts) };
                if (g.scope !== null) facts.scope = canonical(g.scope);
                if (sample.length > 0) facts.sample = sample;
                if (g.ids.length > sample.length) facts.affectedIn = AFFECTED_TABLE;
                return { code: g.code, level: WARNING_LEVELS[g.code], facts };
            });
    }

    // Every affected id, for the table beside result.json.
    affectedRows() {
        const out = [];
        for (const k of this.order) {
            const g = this.groups.get(k);
            for (const id of g.ids) out.push({ code: g.code, scope: scopeKey(g.scope), id });
        }
        return out.sort((a, b) => byCodepoint(a.code, b.code)
            || byCodepoint(a.scope, b.scope)
            || byCodepoint(String(a.id), String(b.id)));
    }
}
