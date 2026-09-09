import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { residueDistances } from '../../plugin/analysis/src/folddisco/residue-distances.mjs';
import { Warnings } from '../../plugin/analysis/src/io/warnings.mjs';

const write = (root, name, value) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
};

test('FoldDisco residue distances apply target-to-query transforms without shifting across gaps', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foldseek-residue-distance-'));
    try {
        write(root, 'query.json', JSON.stringify({
            queryResidues: ['A10', 'A11', 'A12', 'A13'],
            positions: [
                { motifIndex: 0, residue: 'A10', queryCa: [0, 0, 0] },
                { motifIndex: 1, residue: 'A11', queryCa: [11, 0, 0] },
                { motifIndex: 2, residue: 'A12', queryCa: [22, 0, 0] },
                { motifIndex: 3, residue: 'A13', queryCa: [30, 0, 0] },
            ],
        }));
        write(root, 'db-0.geometry.jsonl', `${JSON.stringify({
            id: '0#0', target: '1abc.ent', queryResidues: ['A10', 'A11', 'A12', 'A13'],
            positions: [
                { motifIndex: 0, targetResidue: null, targetCa: null },
                { motifIndex: 1, targetResidue: 'B20', targetCa: [10, 0, 0] },
                { motifIndex: 2, targetResidue: 'B21', targetCa: [40, 0, 0] },
                { motifIndex: 3, targetResidue: null, targetCa: null },
            ],
            tmat: [1, 0, 0],
            umat: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        })}\n`);
        const context = {
            root,
            selected: [0],
            records: new Map([[0, { id: 'pdb_folddisco', display: 'PDB' }]]),
            roles: {
                'query-residue-coordinates': { units: [{ path: 'query.json' }] },
                'residue-geometry': { units: [{ dbIndex: 0, path: 'db-0.geometry.jsonl' }] },
            },
            warnings: new Warnings(),
        };

        const out = await residueDistances.run(context);
        assert.deepEqual(out.tables['residue-distances'].rows.map(row => row.distanceA), [null, 0, 19, null]);
        assert.deepEqual(out.tables['residue-distances'].rows.map(row => row.targetResidue),
            [null, 'B20', 'B21', null]);
        assert.equal(out.tables['hit-distance-summary'].rows[0].gaps, 2);
        assert.equal(out.tables['hit-distance-summary'].rows[0].over10A, 1);
        assert.equal(out.tables['residue-distance-summary'].rows[1].matchedHits, 1);
        assert.equal(out.tables['residue-distance-summary'].rows[2].over10Fraction, 1);
        assert.equal(out.tables['residue-distance-summary'].rows[0].gapHits, 1);
        assert.deepEqual(out.summary.perDatabase[0], {
            dbIndex: 0,
            id: 'pdb_folddisco',
            display: 'PDB',
            hitsAnalyzed: 1,
            matchedResidues: 2,
            measuredComparisons: 2,
            gaps: 2,
            over5A: 1,
            over10A: 1,
        });
        assert.deepEqual(context.warnings.toJSON(), []);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('the rotation is applied to target coordinates, not to query coordinates', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foldseek-residue-rotation-'));
    try {
        write(root, 'query.json', JSON.stringify({
            queryResidues: ['A10'],
            positions: [{ motifIndex: 0, residue: 'A10', queryCa: [0, 1, 0] }],
        }));
        write(root, 'db-0.geometry.jsonl', `${JSON.stringify({
            id: '0#0', target: 'rotation', queryResidues: ['A10'],
            positions: [{ motifIndex: 0, targetResidue: 'B20', targetCa: [1, 0, 0] }],
            tmat: [0, 0, 0],
            umat: [0, -1, 0, 1, 0, 0, 0, 0, 1],
        })}\n`);
        const out = await residueDistances.run({
            root,
            selected: [0],
            records: new Map([[0, { id: 'db' }]]),
            roles: {
                'query-residue-coordinates': { units: [{ path: 'query.json' }] },
                'residue-geometry': { units: [{ dbIndex: 0, path: 'db-0.geometry.jsonl' }] },
            },
            warnings: new Warnings(),
        });
        assert.equal(out.tables['residue-distances'].rows[0].distanceA, 0);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
