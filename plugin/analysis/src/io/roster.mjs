import { fail } from './errors.mjs';

// Validate every manifest or summary database roster here.
export function validateRoster(databases, { source }) {
    if (!Array.isArray(databases)) {
        fail('DATABASE_ROSTER_INVALID', { source, reason: 'absent or not an array' });
    }

    const byIndex = new Map();
    for (const db of databases) {
        if (db === null || typeof db !== 'object') {
            fail('DATABASE_ROSTER_INVALID', { source, reason: 'an entry is not an object' });
        }
        if (!Number.isInteger(db.dbIndex) || db.dbIndex < 0) {
            fail('DATABASE_ROSTER_INVALID', {
                source, reason: 'no non-negative integer dbIndex', value: db.dbIndex ?? null,
            });
        }
        // Refuse duplicate indices before building the lookup.
        if (byIndex.has(db.dbIndex)) {
            fail('DATABASE_ROSTER_INVALID', { source, reason: 'repeated dbIndex', dbIndex: db.dbIndex });
        }
        byIndex.set(db.dbIndex, db);
    }
    return byIndex;
}

// Validate manifest row counts once for all count-gated roles.
export function manifestCounts(manifest) {
    const byIndex = validateRoster(manifest?.databases, { source: 'manifest' });

    const counts = new Map();
    for (const [dbIndex, db] of byIndex) {
        if (!Number.isInteger(db.parsedRows) || db.parsedRows < 0) {
            fail('DATABASE_ROSTER_INVALID', {
                source: 'manifest',
                reason: 'parsedRows is missing, non-integer or negative',
                dbIndex,
                value: db.parsedRows ?? null,
            });
        }
        counts.set(dbIndex, db.parsedRows);
    }

    // Refuse mismatched roster and manifest totals.
    const declaredTotal = manifest?.counts?.parsedRows;
    if (counts.size > 0 && Number.isInteger(declaredTotal)) {
        const summed = [...counts.values()].reduce((a, b) => a + b, 0);
        if (summed !== declaredTotal) {
            fail('DATABASE_ROSTER_INVALID', {
                source: 'manifest', reason: 'per-database counts do not sum to counts.parsedRows',
                value: summed, declaredTotal,
            });
        }
    }
    return counts;
}

// Identity per database, for labelling rows.
export function rosterLabels(databases, { source }) {
    const byIndex = validateRoster(databases, { source });
    return new Map([...byIndex].map(([dbIndex, db]) => [dbIndex, db.id ?? null]));
}
