import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GROUPS, SUBCOMMANDS, namesIn } from '../../plugin/analysis/src/cli/registry.mjs';
import {
    ENVELOPE_FLAGS, UNIVERSAL_FLAGS, optionalPositiveInteger,
} from '../../plugin/analysis/src/cli/args.mjs';
import { table as hitTable } from '../../plugin/analysis/src/hit/table.mjs';
import { phyletic } from '../../plugin/analysis/src/hit/phyletic.mjs';
import { columnRanking } from '../../plugin/analysis/src/msa/column-ranking.mjs';
import { Warnings } from '../../plugin/analysis/src/io/warnings.mjs';
import { writeTsv } from '../../plugin/analysis/src/io/write.mjs';
import { tmp } from '../support/temp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..');
const REACH_DATA = path.join(ROOT, 'plugin', 'analysis', 'data', 'reach-v1.json');
const EXPECTED = {
    folddisco: ['residue-distances', 'residue-retention', 'result-metrics', 'shortlist'],
    hit: ['coverage', 'member-selection', 'phyletic', 'survey', 'table'],
    msa: ['author-numbering', 'blocks', 'column-ranking', 'compactness', 'member-audit', 'qc',
        'substitution-proposal'],
    workflow: ['reach'],
};

test('the public analysis surface loads with its complete command set', () => {
    assert.deepEqual(GROUPS, Object.keys(EXPECTED).sort());
    for (const [group, names] of Object.entries(EXPECTED)) {
        assert.deepEqual(namesIn(group), [...names].sort(), group);
    }
});

test('the removed policy selector is not part of the CLI envelope', () => {
    assert.equal(ENVELOPE_FLAGS.includes('policy'), false);
    assert.equal(UNIVERSAL_FLAGS.includes('policy'), false);
});

test('taxon selectors are positive numeric NCBI ids', () => {
    assert.equal(optionalPositiveInteger(new Map([['taxon', '9606']]), 'taxon'), 9606);
    assert.throws(() => optionalPositiveInteger(new Map([['taxon', 'Homo sapiens']]), 'taxon'),
        /positive integer/);
    assert.throws(() => optionalPositiveInteger(new Map([['taxon', '0']]), 'taxon'),
        /positive integer/);
});

test('every command has a runnable versioned contract', () => {
    for (const [name, spec] of Object.entries(SUBCOMMANDS)) {
        assert.equal(spec.name, name);
        assert.equal(spec.version, 1, `${name}: analysis version`);
        assert.equal(typeof spec.run, 'function', `${name}: no runner`);
        assert.ok(Array.isArray(spec.roles), `${name}: roles`);
        assert.ok(Array.isArray(spec.options), `${name}: options`);
        assert.equal('policy' in spec, false, `${name}: exposes a removed policy selector`);
    }
});

test('reach keeps its collection equivalences as fixed versioned data', () => {
    const data = JSON.parse(fs.readFileSync(REACH_DATA, 'utf8'));
    assert.deepEqual(Object.keys(data).sort(), ['analysisVersion', 'collectionMap', 'collectionMapVersion']);
    assert.equal(data.analysisVersion, 1);
    assert.equal(data.collectionMapVersion, 'collections-1');
    assert.deepEqual(data.collectionMap, {
        pdb100: 'pdb',
        pdb_folddisco: 'pdb',
        afdb50: 'afdb-uniprot50',
        afdb50_folddisco: 'afdb-uniprot50',
        'afdb-proteome': 'afdb-proteome',
        'afdb-proteome_folddisco': 'afdb-proteome',
        BFVD: 'bfvd',
        BFVD_folddisco: 'bfvd',
        mgnify_esm30: 'esm30',
        esm30_folddisco: 'esm30',
    });
    for (const [database, collection] of Object.entries(data.collectionMap)) {
        assert.ok(database.length > 0);
        assert.ok(typeof collection === 'string' && collection.length > 0);
    }
});

test('hit/table preserves descriptions and previews top-ranked hits', async () => {
    const root = tmp('hit-description-');
    const rows = [
        { id: '0#0', target: 'a', score: 10, qLen: 100, qStartPos: 1, qEndPos: 80, description: 'Kinase' },
        { id: '0#1', target: 'b', score: 9, qLen: 100, qStartPos: 1, qEndPos: 70, description: 'Kinase' },
        { id: '0#2', target: 'c', score: 8, qLen: 100, qStartPos: 1, qEndPos: 60, description: 'Beta\tprotein\nnote' },
        { id: '0#3', target: 'd', score: 7, qLen: 100, qStartPos: 1, qEndPos: 50 },
    ];
    fs.writeFileSync(path.join(root, 'rows.jsonl'), `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
    const warnings = new Warnings();
    const result = await hitTable.run({
        root,
        ranking: { field: 'score', label: 'Score', direction: 'higher', crossDatabaseComparable: true },
        metricSemantics: {}, completeness: { complete: true, saturated: false }, tool: 'foldseek',
        roles: { rows: { units: [{ dbIndex: 0, path: 'rows.jsonl' }] } },
        selected: [0], records: new Map([[0, { id: 'db', parsedRows: rows.length }]]),
        warnings, top: null, args: new Map(),
    });

    assert.deepEqual(result.summary.databases[0].descriptions, {
        withDescription: 3,
        missing: 1,
        topHits: [
            { rankInDatabase: 1, id: '0#0', target: 'a', description: 'Kinase' },
            { rankInDatabase: 2, id: '0#1', target: 'b', description: 'Kinase' },
            { rankInDatabase: 3, id: '0#2', target: 'c', description: 'Beta\tprotein\nnote' },
            { rankInDatabase: 4, id: '0#3', target: 'd', description: '' },
        ],
    });
    assert.match(result.summary.descriptionBasis, /top-ranked hits; no function inference/);
    assert.equal(result.tables.hits.header.at(-1), 'description');
    assert.equal(result.tables.hits.rows[2].description, 'Beta\tprotein\nnote');
    assert.equal(warnings.toJSON()[0].code, 'MISSING_DESCRIPTIONS');

    const file = path.join(root, 'hits.tsv');
    writeTsv(file, result.tables.hits.header, result.tables.hits.rows);
    const written = fs.readFileSync(file, 'utf8');
    assert.equal(written.split('\n').length, rows.length + 2, 'a description cannot add TSV rows');
    assert.match(written, /Beta\\tprotein\\nnote/);
});

test('hit/phyletic emits exact and descendant hits for one numeric taxon', async () => {
    const root = tmp('taxon-hits-');
    const rows = [
        { id: '0#0', target: 'descendant', score: 8, seqId: 35, qLen: 100, qStartPos: 1, qEndPos: 80, taxId: 11, taxName: 'Child', description: 'child hit' },
        { id: '0#1', target: 'exact', score: 7, seqId: 45, qLen: 100, qStartPos: 10, qEndPos: 89, taxId: 10, taxName: 'Selected', description: 'exact hit' },
        { id: '0#2', target: 'outside', score: 6, seqId: 25, qLen: 100, qStartPos: 1, qEndPos: 50, taxId: 20, taxName: 'Other' },
    ];
    fs.writeFileSync(path.join(root, 'rows.jsonl'), `${rows.map(JSON.stringify).join('\n')}\n`);
    fs.writeFileSync(path.join(root, 'taxonomy.json'), JSON.stringify({ nodes: [
        { taxId: 1, name: 'root', rank: 'no rank' },
        { taxId: 10, name: 'Selected', rank: 'phylum', parentTaxId: 1 },
        { taxId: 11, name: 'Child', rank: 'species', parentTaxId: 10 },
        { taxId: 20, name: 'Other', rank: 'species', parentTaxId: 1 },
    ] }));

    const result = await phyletic.run({
        root,
        ranking: { field: 'score' },
        roles: {
            rows: { units: [{ dbIndex: 0, path: 'rows.jsonl', rows: rows.length }] },
            taxonomy: { units: [{ dbIndex: 0, path: 'taxonomy.json' }] },
        },
        selected: [0],
        records: new Map([[0, { id: 'db', taxonomyTree: true }]]),
        warnings: new Warnings(),
        args: new Map([['taxon', '10']]),
    });

    assert.deepEqual(result.summary.taxonFilter, {
        taxId: 10,
        ancestryAvailable: true,
        assessmentComplete: true,
        assessedRows: 3,
        unassessedRows: 0,
        presentInTree: true,
        matchedRows: 2,
        databases: [{ dbIndex: 0, id: 'db', presentInTree: true, name: 'Selected', rank: 'phylum', matchedRows: 2 }],
        claim: 'reported membership uses exported taxId ancestry; taxName is display only',
    });
    assert.deepEqual(result.tables['taxon-hits'].rows.map(row => ({
        id: row.id, distanceToTaxon: row.distanceToTaxon, coverage: row.coverage,
    })), [
        { id: '0#0', distanceToTaxon: 1, coverage: 0.8 },
        { id: '0#1', distanceToTaxon: 0, coverage: 0.8 },
    ]);
    assert.equal(result.tables['taxon-hits'].rows[0].requestedTaxName, 'Selected');
    assert.equal(result.tables['taxon-hits'].rows[0].rankingValue, 8);
});

test('hit/phyletic does not infer descendant membership from taxName without a tree', async () => {
    const root = tmp('taxon-no-tree-');
    const rows = [{ id: '0#0', target: 'named-only', taxId: 11, taxName: 'Selected' }];
    fs.writeFileSync(path.join(root, 'rows.jsonl'), `${rows.map(JSON.stringify).join('\n')}\n`);
    const warnings = new Warnings();
    const result = await phyletic.run({
        root,
        ranking: { field: 'score' },
        roles: {
            rows: { units: [{ dbIndex: 0, path: 'rows.jsonl', rows: rows.length }] },
            taxonomy: { units: [] },
        },
        selected: [0],
        records: new Map([[0, { id: 'db', taxonomyTree: false }]]),
        warnings,
        args: new Map([['taxon', '10']]),
    });

    assert.deepEqual(result.summary.taxonFilter, {
        taxId: 10,
        ancestryAvailable: false,
        assessmentComplete: false,
        assessedRows: 0,
        unassessedRows: 1,
        presentInTree: false,
        matchedRows: null,
        databases: [],
        claim: 'no usable taxonomy tree was available, so descendant membership was not inferred',
    });
    assert.deepEqual(result.tables['taxon-hits'].rows, []);
    assert.ok(warnings.toJSON().some(warning => warning.code === 'NO_TAXONOMY_TREE'));
});

test('column ranking preserves property vectors without turning them into another ranking rule', async () => {
    const root = tmp('column-properties-');
    fs.writeFileSync(path.join(root, 'entries.json'), JSON.stringify({
        totalEntries: 2,
        columns: 2,
        entries: [
            { index: 0, name: 'query', residueCount: 2, alignedLength: 2 },
            { index: 1, name: 'hit', residueCount: 2, alignedLength: 2 },
        ],
    }));
    const columns = [
        {
            column: 0,
            occupancy: 1,
            conservation: { score: 5, positive: ['hydrophobic', 'aromatic'], negative: ['!positive'] },
            consensus: { nonGapCount: 2, glyph: 'L', modalFractionNonGap: 1, letters: [] },
        },
        {
            column: 1,
            occupancy: 1,
            conservation: { score: 5, positive: ['polar', 'small'], negative: ['!hydrophobic'] },
            consensus: { nonGapCount: 2, glyph: 'S', modalFractionNonGap: 1, letters: [] },
        },
    ];
    fs.writeFileSync(path.join(root, 'columns.jsonl'), `${columns.map(JSON.stringify).join('\n')}\n`);

    const result = await columnRanking.run({
        root,
        roles: {
            'msa-entries': { present: true, units: [{ path: 'entries.json' }] },
            'msa-columns': { present: true, units: [{ path: 'columns.jsonl' }] },
        },
        warnings: new Warnings(),
        top: null,
    });

    assert.deepEqual(result.summary.ranked.map(({ rank, column, positive, negative }) => ({
        rank, column, positive, negative,
    })), [
        { rank: 1, column: 0, positive: ['hydrophobic', 'aromatic'], negative: ['!positive'] },
        { rank: 2, column: 1, positive: ['polar', 'small'], negative: ['!hydrophobic'] },
    ]);
    assert.deepEqual(result.tables['columns-ranked'].header.slice(4, 7),
        ['conservationScore', 'positive', 'negative']);
    assert.equal(result.tables['columns-ranked'].rows[0].positive, 'hydrophobic aromatic');
    assert.equal(result.tables['columns-ranked'].rows[1].negative, '!hydrophobic');
    assert.match(result.summary.claim, /selecting residues remains an explicit decision/);
});
