// Measure gap-aware FoldDisco residue distances after placing target coordinates in the query frame.

import { confineExisting } from '../io/paths.mjs';
import { readJson, readJsonl } from '../io/streams.mjs';
import { labelOf, round, spread } from './motif.mjs';

const LIMITS = Object.freeze({ rows: 1000000, residues: 4096 });

export const residueDistances = {
    name: 'folddisco/residue-distances',
    version: 1,
    roles: ['query-residue-coordinates', 'residue-geometry'],
    options: [],

    async run(context) {
        const query = readQuery(context);
        const geometryUnits = new Map(context.roles['residue-geometry'].units
            .map(unit => [unit.dbIndex, unit]));
        const details = [];
        const hits = [];
        const residues = [];
        const perDatabase = [];

        for (const dbIndex of context.selected) {
            const label = labelOf(context.records, dbIndex);
            const collected = await collectDatabase(context, geometryUnits.get(dbIndex), label, query);
            details.push(...collected.details);
            hits.push(...collected.hits);
            residues.push(...collected.residues);
            perDatabase.push({
                ...label,
                hitsAnalyzed: collected.hits.length,
                matchedResidues: collected.details.filter(row => row.matched).length,
                measuredComparisons: collected.details.filter(row => row.measured).length,
                gaps: collected.details.filter(row => !row.matched).length,
                over5A: collected.details.filter(row => row.over5A).length,
                over10A: collected.details.filter(row => row.over10A).length,
            });
        }

        return {
            summary: {
                motifSize: query.length,
                transform: 'alignedTargetCa = umat * targetCa + tmat; distance to queryCa',
                thresholdsAngstrom: [5, 10],
                perDatabase,
                claimLimit: 'distance outliers identify residue correspondences to review; they do not prove a false positive',
            },
            tables: {
                'residue-distances': detailTable(details),
                'hit-distance-summary': hitTable(hits),
                'residue-distance-summary': residueTable(residues),
            },
        };
    },
};

function finiteTriplet(value) {
    return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function finiteMatrix(value) {
    return Array.isArray(value) && value.length === 9 && value.every(Number.isFinite);
}

function readQuery(context) {
    const unit = context.roles['query-residue-coordinates'].units[0];
    const doc = readJson(confineExisting(context.root, unit.path), { label: unit.path });
    if (!Array.isArray(doc?.queryResidues) || !Array.isArray(doc?.positions)
        || doc.queryResidues.length !== doc.positions.length || doc.positions.length > LIMITS.residues
        || doc.positions.some((position, index) => position?.motifIndex !== index
            || position?.residue !== doc.queryResidues[index])) {
        context.warnings.add('COORDINATE_COUNT_MISMATCH', {
            facts: { reason: 'invalid query residue coordinate roster' },
        });
        return [];
    }
    const missing = doc.positions.filter(position => !finiteTriplet(position?.queryCa)).length;
    if (missing > 0) {
        context.warnings.add('COORDINATE_COUNT_MISMATCH', {
            facts: { missing, reason: 'query motif residues without a C-alpha coordinate' },
        });
    }
    return doc.positions.map((position, motifIndex) => ({
        motifIndex,
        residue: doc.queryResidues[motifIndex],
        ca: finiteTriplet(position?.queryCa) ? position.queryCa : null,
    }));
}

function transformed(point, t, u) {
    return [
        u[0] * point[0] + u[1] * point[1] + u[2] * point[2] + t[0],
        u[3] * point[0] + u[4] * point[1] + u[5] * point[2] + t[1],
        u[6] * point[0] + u[7] * point[1] + u[8] * point[2] + t[2],
    ];
}

function distance(left, right) {
    return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

async function collectDatabase(context, unit, label, query) {
    const details = [];
    const hitRows = [];
    const byResidue = query.map(() => ({ distances: [], gaps: 0, hits: 0, matched: 0 }));
    let invalid = 0;
    if (!unit || unit.path === null) return { details, hits: hitRows, residues: [] };

    for await (const row of readJsonl(confineExisting(context.root, unit.path), { label: unit.path })) {
        if (hitRows.length >= LIMITS.rows) break;
        const valid = Array.isArray(row.positions) && row.positions.length === query.length
            && Array.isArray(row.queryResidues) && row.queryResidues.length === query.length
            && row.queryResidues.every((residue, index) => residue === query[index]?.residue)
            && row.positions.every((position, index) => position?.motifIndex === index)
            && row.positions.every(position => position?.targetResidue === null
                ? position?.targetCa === null
                : typeof position?.targetResidue === 'string' && finiteTriplet(position?.targetCa))
            && finiteTriplet(row.tmat) && finiteMatrix(row.umat);
        if (!valid) {
            invalid += 1;
            continue;
        }

        const hitDistances = [];
        let gaps = 0;
        for (let motifIndex = 0; motifIndex < query.length; motifIndex += 1) {
            const target = row.positions[motifIndex];
            const matched = target?.targetResidue !== null;
            const measured = matched && finiteTriplet(target?.targetCa) && finiteTriplet(query[motifIndex].ca);
            let value = null;
            if (measured) {
                value = distance(query[motifIndex].ca, transformed(target.targetCa, row.tmat, row.umat));
                hitDistances.push(value);
                byResidue[motifIndex].distances.push(value);
            }
            if (!matched) {
                gaps += 1;
                byResidue[motifIndex].gaps += 1;
            }
            if (matched) byResidue[motifIndex].matched += 1;
            byResidue[motifIndex].hits += 1;
            details.push({
                ...label,
                rowId: String(row.id),
                target: row.target ?? null,
                motifIndex,
                queryResidue: query[motifIndex].residue,
                targetResidue: target?.targetResidue ?? null,
                matched,
                measured,
                distanceA: value === null ? null : round(value, 3),
                over5A: value !== null && value > 5,
                over10A: value !== null && value > 10,
            });
        }
        const stats = spread(hitDistances);
        hitRows.push({
            ...label,
            rowId: String(row.id),
            target: row.target ?? null,
            matchedResidues: query.length - gaps,
            gaps,
            over5A: hitDistances.filter(value => value > 5).length,
            over10A: hitDistances.filter(value => value > 10).length,
            ...stats,
        });
    }

    if (invalid > 0) {
        context.warnings.add('COORDINATE_COUNT_MISMATCH', {
            scope: { dbIndex: label.dbIndex },
            facts: { excluded: invalid, reason: 'invalid residue geometry or transform' },
        });
    }
    const residueRows = byResidue.map((entry, motifIndex) => {
        const stats = spread(entry.distances);
        return {
            ...label,
            motifIndex,
            queryResidue: query[motifIndex].residue,
            hits: entry.hits,
            matchedHits: entry.matched,
            measuredHits: entry.distances.length,
            gapHits: entry.gaps,
            over5A: entry.distances.filter(value => value > 5).length,
            over5Fraction: entry.distances.length
                ? round(entry.distances.filter(value => value > 5).length / entry.distances.length, 3) : null,
            over10A: entry.distances.filter(value => value > 10).length,
            over10Fraction: entry.distances.length
                ? round(entry.distances.filter(value => value > 10).length / entry.distances.length, 3) : null,
            ...stats,
        };
    });
    return { details, hits: hitRows, residues: residueRows };
}

// Rows carry the roster identity as `id`; the `database` column is that id, as in every other FoldDisco table.
const named = rows => rows.map(row => ({ ...row, database: row.id }));

const detailTable = rows => ({
    header: ['dbIndex', 'database', 'rowId', 'target', 'motifIndex', 'queryResidue', 'targetResidue',
        'matched', 'measured', 'distanceA', 'over5A', 'over10A'],
    rows: named(rows),
});

const hitTable = rows => ({
    header: ['dbIndex', 'database', 'rowId', 'target', 'matchedResidues', 'gaps', 'over5A', 'over10A',
        'n', 'min', 'median', 'mean', 'max'],
    rows: named(rows),
});

const residueTable = rows => ({
    header: ['dbIndex', 'database', 'motifIndex', 'queryResidue', 'hits', 'matchedHits', 'measuredHits', 'gapHits',
        'over5A', 'over5Fraction', 'over10A', 'over10Fraction', 'n', 'min', 'median', 'mean', 'max'],
    rows: named(rows),
});
