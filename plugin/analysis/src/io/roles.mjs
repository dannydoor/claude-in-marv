import { fail } from './errors.mjs';
import { manifestCounts } from './roster.mjs';

// Distinguish optional-role absence from required-role corruption.
export const ROLE_RULES = Object.freeze({
    rows: { scope: 'per-db', absent: 'countGated' },
    'motif-patterns': { scope: 'per-db', absent: 'countGated' },
    'residue-geometry': { scope: 'per-db', absent: 'countGated' },
    'query-residue-coordinates': { scope: 'artifact', absent: 'required' },
    taxonomy: { scope: 'per-db', absent: 'degrade' },
    databases: { scope: 'artifact', absent: 'required' },
    'msa-entries': { scope: 'artifact', absent: 'required' },
    'msa-fasta-aa': { scope: 'artifact', absent: 'required' },
    'msa-columns': { scope: 'artifact', absent: 'required' },
    'msa-fasta-3di': { scope: 'artifact', absent: 'degrade' },
    'msa-residue-map': { scope: 'artifact', absent: 'degrade' },
    'msa-coordinates': { scope: 'artifact', absent: 'degrade' },
    'msa-tree': { scope: 'artifact', absent: 'degrade' },
});

// Resolve a role's database from its safe path segment.
const DB_IN_PATH = /(?:^|\/)db-(\d+)\./;

// `absent` overrides what the absence of this role MEANS for the caller.
export function resolveRole(preflighted, role, { absent = null } = {}) {
    const { manifest, roles } = preflighted;
    const declared = ROLE_RULES[role];
    if (!declared) fail('REQUIRED_ROLE_MISSING', { role, reason: 'not a known role' });
    const rule = (absent === null || declared.scope === 'per-db') ? declared : { ...declared, absent };

    const entries = roles.get(role) ?? [];
    return rule.scope === 'per-db'
        ? perDatabase(manifest, role, rule, entries)
        : perArtifact(role, rule, entries);
}

function perArtifact(role, rule, entries) {
    if (entries.length === 0) {
        if (rule.absent === 'required') fail('REQUIRED_ROLE_MISSING', { role });
        return { role, scope: 'artifact', present: false, units: [], degraded: [role] };
    }
    return { role, scope: 'artifact', present: true, units: [entry(entries[0], null)], degraded: [] };
}

function perDatabase(manifest, role, rule, entries) {
    const counts = manifestCounts(manifest);
    const found = new Map();

    for (const file of entries) {
        const match = DB_IN_PATH.exec(file.path);
        const dbIndex = match ? Number(match[1]) : null;
        if (dbIndex === null || !counts.has(dbIndex)) {
            fail('ROLE_DB_INDEX_MISMATCH', {
                role,
                path: file.path,
                declared: [...counts.keys()].sort((a, b) => a - b),
            });
        }
        if (found.has(dbIndex)) fail('ROLE_DB_INDEX_MISMATCH', { role, dbIndex, reason: 'repeated' });
        // A rows file states its own count, and the roster states the same fact.
        if (role === 'rows' && file.rows !== counts.get(dbIndex)) {
            fail('ROLE_DB_INDEX_MISMATCH', {
                role, dbIndex, declaredRows: counts.get(dbIndex), fileRows: file.rows ?? null,
            });
        }
        found.set(dbIndex, entry(file, dbIndex));
    }

    const units = [];
    const degraded = [];
    for (const [dbIndex, count] of [...counts].sort((a, b) => a[0] - b[0])) {
        if (found.has(dbIndex)) {
            units.push(found.get(dbIndex));
            continue;
        }
        if (rule.absent === 'countGated') {
            if (count > 0) fail('REQUIRED_ROLE_MISSING', { role, dbIndex, manifestCount: count });
            units.push({ dbIndex, path: null, rows: 0, bytes: 0, empty: true });
            continue;
        }
        degraded.push(dbIndex);
    }

    return { role, scope: 'per-db', present: units.some(u => u.path !== null), units, degraded };
}

const entry = (file, dbIndex) => ({
    dbIndex,
    path: file.path,
    rows: file.rows ?? null,
    bytes: file.bytes,
    empty: (file.rows ?? 0) === 0,
});
