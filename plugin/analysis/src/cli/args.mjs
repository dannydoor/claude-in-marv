// Define location, selector, assertion and display flags.

// A usage problem is not a loader error.
export class UsageError extends Error {
    constructor(problem, detail = {}) {
        super(problem);
        this.name = 'UsageError';
        this.problem = problem;
        this.detail = detail;
    }

    toJSON() {
        return { usage: { problem: this.problem, detail: this.detail } };
    }
}

export const refuse = (problem, detail) => {
    throw new UsageError(problem, detail);
};

// Every flag the envelope defines.
export const ENVELOPE_FLAGS = Object.freeze([
    'shared-root', 'artifact-root', 'out',
    'db', 'query-idx', 'entry', 'columns', 'reference', 'structure', 'sort', 'top', 'sample', 'taxon',
    'against', 'assert', 'via',
]);

// Assertions state facts about this run rather than selecting data.
export const REPEATABLE_FLAGS = Object.freeze(['assert', 'via']);

// Asked of every subcommand: where the artifact is, where the result goes.
export const UNIVERSAL_FLAGS = Object.freeze([
    'shared-root', 'artifact-root', 'out', 'query-idx', 'sample',
]);

const known = new Set(ENVELOPE_FLAGS);
const repeatable = new Set(REPEATABLE_FLAGS);

// `--name value` and `--name=value`, both.
export function parseArgs(argv, accepted) {
    const allowed = new Set(accepted);
    const given = new Map();
    let i = 0;
    while (i < argv.length) {
        const token = argv[i];
        if (!token.startsWith('--')) refuse('a bare argument was given where a flag was expected', { token });
        const eq = token.indexOf('=');
        const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
        if (!known.has(name)) refuse('unknown flag', { flag: `--${name}`, accepted: [...allowed].sort() });
        if (!allowed.has(name)) {
            refuse('this subcommand does not accept that flag', {
                flag: `--${name}`, accepted: [...allowed].sort(),
            });
        }
        let value;
        if (eq === -1) {
            value = argv[i + 1];
            if (value === undefined || value.startsWith('--')) refuse('flag takes a value', { flag: `--${name}` });
            i += 2;
        } else {
            value = token.slice(eq + 1);
            i += 1;
        }
        if (repeatable.has(name)) {
            given.set(name, [...(given.get(name) ?? []), value]);
            continue;
        }
        if (given.has(name)) refuse('flag given twice', { flag: `--${name}` });
        given.set(name, value);
    }
    return given;
}

// Every value given for a repeatable flag, in the order the caller gave them.
export function repeatedValues(given, name) {
    const value = given.get(name);
    if (value === undefined) return [];
    return Array.isArray(value) ? [...value] : [value];
}

export function required(given, name) {
    const value = given.get(name);
    if (value === undefined || value === '') refuse('a required flag is missing', { flag: `--${name}` });
    return value;
}

export function optionalInteger(given, name) {
    if (!given.has(name)) return null;
    const raw = given.get(name);
    if (!/^\d+$/.test(raw)) refuse('flag takes a non-negative integer', { flag: `--${name}`, value: raw });
    return Number(raw);
}

export function optionalPositiveInteger(given, name) {
    if (!given.has(name)) return null;
    const raw = given.get(name);
    if (!/^[1-9]\d*$/.test(raw)) refuse('flag takes a positive integer', { flag: `--${name}`, value: raw });
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) refuse('flag takes a safe positive integer', { flag: `--${name}`, value: raw });
    return value;
}

// Select every database with `*`, or list database indices or ids.
export function databaseSelector(given) {
    const raw = given.get('db');
    if (raw === undefined || raw === '*') return { all: true, wanted: [] };
    const wanted = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (wanted.length === 0) refuse('flag takes * or a comma list', { flag: '--db', value: raw });
    return { all: false, wanted };
}
