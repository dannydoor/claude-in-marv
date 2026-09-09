// Run-envelope, warning-aggregation and determinism tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { tmp } from '../support/temp.mjs';

import { buildResult, buildRun, writeRun, logicalTool } from '../../plugin/analysis/src/io/envelope.mjs';
import { Warnings, WARNING_LEVELS } from '../../plugin/analysis/src/io/warnings.mjs';
import { readJsonl, readFasta, readGzipJson } from '../../plugin/analysis/src/io/streams.mjs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const codeOf = fn => {
    try { fn(); } catch (e) { return e.code; }
    return null;
};

const ANALYSIS_VERSION = 1;
const INPUT = { artifactId: 'abc123', ticket: 'T-1', queryIdx: 0, roles: ['rows', 'taxonomy'] };

test('run.json records provenance and excludes the host tool prefix', () => {
    const run = buildRun({
        analysis: 'hit/table',
        analysisVersion: ANALYSIS_VERSION,
        tool: 'mcp__some-host__Foldseek_Server__foldseek_search',
        serverNamespace: 'https://search.foldseek.com/api',
        input: INPUT,
        roles: ['rows', 'taxonomy'],
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:01.000Z',
    });
    assert.equal(run.tool, 'foldseek_search');
    assert.equal(run.analysisVersion, ANALYSIS_VERSION);
    assert.equal('policy' in run, false);
    assert.equal(JSON.stringify(run).includes('mcp__'), false);
    assert.equal(JSON.stringify(run).includes('some-host'), false);
    for (const key of ['analysisVersion', 'serverNamespace', 'ticket', 'queryIdx', 'artifactId', 'roles']) {
        assert.ok(key in run, key);
    }
    assert.equal(logicalTool('foldseek_search'), 'foldseek_search');
});

test('result.json carries no timestamp and run.json carries the only clock', () => {
    const result = buildResult({ analysis: 'hit/table', analysisVersion: ANALYSIS_VERSION, input: INPUT, summary: { rows: 290 } });
    assert.equal(result.analysisVersion, ANALYSIS_VERSION);
    assert.equal('policy' in result, false);
    const text = JSON.stringify(result);
    assert.equal(/startedAt|finishedAt|\d{4}-\d{2}-\d{2}T/.test(text), false);
});

test('queryIdx is preserved as absent, never synthesised to zero', () => {
    const msa = { artifactId: 'abc', ticket: 'T-2', roles: ['msa-columns'] };
    const result = buildResult({ analysis: 'msa/qc', analysisVersion: ANALYSIS_VERSION, input: msa });
    assert.equal('queryIdx' in result.input, false);

    const run = buildRun({
        analysis: 'msa/qc', analysisVersion: ANALYSIS_VERSION,
        tool: 'foldmason_msa', serverNamespace: 'ns', input: msa, roles: ['msa-columns'],
        startedAt: 'a', finishedAt: 'b',
    });
    assert.equal('queryIdx' in run, false);

    // An explicit zero is kept, because a Foldseek summary really does carry it.
    assert.equal(buildResult({ analysis: 'x', analysisVersion: ANALYSIS_VERSION, input: INPUT }).input.queryIdx, 0);
});

test('result.json size does not grow with row count', () => {
    const built = [10, 1000, 100000].map(n => {
        const warnings = new Warnings();
        for (let i = 0; i < n; i += 1) warnings.add('SATURATED_ROWS', { scope: { dbIndex: 0 }, id: `0#${i}` });
        const result = buildResult({ analysis: 'hit/table', analysisVersion: ANALYSIS_VERSION, input: INPUT, warnings });
        return { entries: result.warnings.length, sample: result.warnings[0].facts.sample.length, size: JSON.stringify(result).length };
    });
    // One entry and a five-id sample whatever the row count. What does grow is bounded and incidental:
    // the digits of `count`, and the width of the five sampled ids once ids get longer.
    assert.deepEqual(built.map(b => b.entries), [1, 1, 1]);
    assert.deepEqual(built.map(b => b.sample), [5, 5, 5]);
    const growth = built[2].size - built[0].size;
    assert.ok(growth < 64, `grew by ${growth} bytes across a 10,000x row increase`);
});

test('warnings aggregate by code and scope, with a count and a bounded sample', () => {
    const warnings = new Warnings();
    for (let i = 0; i < 40; i += 1) warnings.add('SATURATED_ROWS', { scope: { dbIndex: 0 }, id: `0#${i}` });
    for (let i = 0; i < 7; i += 1) warnings.add('SATURATED_ROWS', { scope: { dbIndex: 1 }, id: `1#${i}` });
    warnings.add('ZERO_HIT_DATABASE', { scope: { dbIndex: 2 } });

    const emitted = warnings.toJSON();
    assert.equal(emitted.length, 3, 'one entry per code and scope, never per row');
    const first = emitted.find(w => w.facts.scope?.dbIndex === 0);
    assert.equal(first.facts.count, 40);
    assert.equal(first.facts.sample.length, 5);
    assert.equal(first.facts.affectedIn, 'tables/warnings.tsv');
    assert.equal(first.level, 'caution');
    // A code with no ids carries a count and no sample.
    const note = emitted.find(w => w.code === 'ZERO_HIT_DATABASE');
    assert.equal(note.level, 'note');
    assert.equal('sample' in note.facts, false);
    // The full affected set is available for the table.
    assert.equal(warnings.affectedRows().length, 47);
});

test('the module and the shipped reference declare the same codes at the same levels', () => {
    // Two copies of one vocabulary. Checking the module against itself would let them drift silently,
    // so the shipped reference is the comparison.
    const reference = fs.readFileSync(
        path.join(HERE, '..', '..', 'plugin', 'skills', 'references', 'reporting.md'), 'utf8');
    const rows = [...reference.matchAll(/^\| `([A-Z_]+)` \| (blocking|caution|note) \|/gm)]
        .map(m => [m[1], m[2]]);
    assert.ok(rows.length > 0, 'the reference warning table is empty');
    assert.deepEqual(Object.fromEntries(rows.sort()), Object.fromEntries(Object.entries(WARNING_LEVELS).sort()));
    assert.equal(codeOf(() => new Warnings().add('NOT_A_CODE')), 'INVALID_ANALYSIS');
});

test('a warning never stops a run', () => {
    const warnings = new Warnings();
    warnings.add('REFERENCE_RESIDUE_ABSENT', { scope: { column: 12 } });
    // It is reported, not thrown: the result still builds.
    const result = buildResult({ analysis: 'msa/column-ranking', analysisVersion: ANALYSIS_VERSION, input: INPUT, warnings });
    assert.equal(result.warnings[0].level, 'blocking');
});

test('two runs on the same bytes and analysis version write byte-identical output apart from run.json', () => {
    // The two runs deliberately visit the same facts in OPPOSITE order, and add more affected ids than
    // the sample holds. A determinism test that varies nothing can only catch a clock leak.
    const VISITS = [
        { ids: ['0#3', '0#1', '0#2', '0#9', '0#4', '0#7'], facts: [{ withDescription: 10 }, { total: 44 }] },
        { ids: ['0#7', '0#4', '0#9', '0#2', '0#1', '0#3'], facts: [{ total: 44 }, { withDescription: 10 }] },
    ];
    const build = visit => {
        const warnings = new Warnings();
        for (const id of visit.ids) warnings.add('SATURATED_ROWS', { scope: { dbIndex: 0 }, id });
        for (const facts of visit.facts) warnings.add('MISSING_DESCRIPTIONS', { scope: { dbIndex: 0 }, facts });
        warnings.add('NO_TAXONOMY_TREE', { scope: { dbIndex: 1 } });
        return {
            result: buildResult({
                analysis: 'hit/table', analysisVersion: ANALYSIS_VERSION, input: INPUT,
                summary: { rows: 290, databases: 3 },
                files: [{ role: 'rows', path: 'tables/hits.tsv' }],
                warnings,
            }),
            warnings,
        };
    };

    const dirs = ['a', 'b'].map((label, i) => {
        const dir = tmp(`run-${label}-`);
        const { result, warnings } = build(VISITS[i]);
        const run = buildRun({
            analysis: 'hit/table', analysisVersion: ANALYSIS_VERSION,
            tool: 'foldseek_search', serverNamespace: 'ns', input: INPUT, roles: INPUT.roles,
            startedAt: `2026-01-0${i + 1}T00:00:00.000Z`,
            finishedAt: `2026-01-0${i + 1}T00:00:02.000Z`,
        });
        writeRun(dir, { run, result, warnings, tables: { hits: { header: ['id', 'score'], rows: [{ id: '0#0', score: 724 }] } } });
        return dir;
    });

    const read = (dir, rel) => fs.readFileSync(path.join(dir, rel));
    assert.deepEqual(read(dirs[0], 'result.json'), read(dirs[1], 'result.json'));
    assert.deepEqual(read(dirs[0], 'tables/hits.tsv'), read(dirs[1], 'tables/hits.tsv'));
    assert.deepEqual(read(dirs[0], 'tables/warnings.tsv'), read(dirs[1], 'tables/warnings.tsv'));
    // The clock lives only in run.json, which is excluded from the comparison.
    assert.notDeepEqual(read(dirs[0], 'run.json'), read(dirs[1], 'run.json'));
    assert.match(JSON.parse(read(dirs[0], 'run.json')).startedAt, /^2026-01-01/);
});

test('warnings are emitted in a stable order regardless of visit order', () => {
    const build = ids => {
        const w = new Warnings();
        for (const id of ids) w.add('SATURATED_ROWS', { scope: { dbIndex: 0 }, id });
        w.add('ZERO_HIT_DATABASE', { scope: { dbIndex: 1 } });
        w.add('DATABASE_ERROR', { scope: { dbIndex: 2 } });
        return w;
    };
    const forward = build(['0#2', '0#1', '0#3', '0#8', '0#5', '0#4']);
    const reverse = build(['0#4', '0#5', '0#8', '0#3', '0#1', '0#2']);

    // The table.
    assert.deepEqual(forward.affectedRows(), reverse.affectedRows());
    // And result.json itself, including the bounded sample inside each entry — the sample is drawn
    // from the sorted id set, not from arrival order.
    assert.deepEqual(forward.toJSON(), reverse.toJSON());
    // The order distinct codes are FIRST seen must not reach the output either — this is what gates
    // the group-level sort, which id-only variation leaves untouched.
    const codeOrder = codes => {
        const w = new Warnings();
        for (const code of codes) w.add(code, { scope: { dbIndex: 0 } });
        return JSON.stringify(w.toJSON());
    };
    assert.equal(codeOrder(['SATURATED_ROWS', 'ZERO_HIT_DATABASE', 'DATABASE_ERROR']),
        codeOrder(['DATABASE_ERROR', 'SATURATED_ROWS', 'ZERO_HIT_DATABASE']));

    // And one logical scope is one group however the caller spelled its keys.
    const spelled = new Warnings();
    spelled.add('SATURATED_ROWS', { scope: { dbIndex: 0, role: 'rows' } });
    spelled.add('SATURATED_ROWS', { scope: { role: 'rows', dbIndex: 0 } });
    assert.equal(spelled.toJSON().length, 1, 'scope keys are compared by content, not by spelling');

    // A fact redefined with a different value is a caller bug, not a silent last-write-wins.
    const conflicting = new Warnings();
    conflicting.add('SATURATED_ROWS', { facts: { rowCap: 300 } });
    assert.doesNotThrow(() => conflicting.add('SATURATED_ROWS', { facts: { rowCap: 300 } }));
    assert.throws(() => conflicting.add('SATURATED_ROWS', { facts: { rowCap: 500 } }), /INVALID_ANALYSIS/);

    const saturated = forward.toJSON().find(w => w.code === 'SATURATED_ROWS');
    assert.deepEqual(saturated.facts.sample, ['0#1', '0#2', '0#3', '0#4', '0#5']);
    assert.equal(saturated.facts.count, 6, 'the count is every affected id, not the sample');
    // Codepoint order, not locale collation: a host's ICU locale must not change the bytes.
    const collating = build(['0#a', '0#A', '0#_']);
    assert.deepEqual(collating.affectedRows().map(r => r.id), ['0#A', '0#_', '0#a']);
});

test('a malformed row is a structured error naming its line and no content', async () => {
    const dir = tmp('rows-');
    const file = path.join(dir, 'rows.jsonl');
    fs.writeFileSync(file, '{"id":"0#0"}\n\n{"id":"0#1"}\nnot json\n');
    const seen = [];
    let code = null;
    try {
        for await (const row of readJsonl(file, { label: 'db-0.rows.jsonl' })) seen.push(row.id);
    } catch (e) {
        code = e.code;
        assert.deepEqual(e.facts, { file: 'db-0.rows.jsonl', line: 4 });
    }
    assert.equal(code, 'MALFORMED_ROW');
    assert.deepEqual(seen, ['0#0', '0#1'], 'blank lines are skipped, rows before the failure are yielded');
});

test('the FASTA reader joins wrapped alignment lines', async () => {
    const dir = tmp('fasta-');
    const aa = path.join(dir, 'aa.fasta');
    fs.writeFileSync(aa, '>one\nAAAA\nBBBB\n>two\nCCCC\nDDDD\n>three\nEEEE\nFFFF\n');
    const entries = [];
    for await (const e of readFasta(aa)) entries.push(e);
    assert.equal(entries.length, 3);
    assert.deepEqual([...new Set(entries.map(e => e.sequence.length))], [8]);
    assert.deepEqual(entries.map(e => e.name), ['one', 'two', 'three']);
});

test('the FASTA reader never normalises case', async () => {
    // Case is meaning in a substitution: lower-case letters are group codes, upper-case are residues.
    const dir = tmp('fasta-');
    const file = path.join(dir, 'mixed.fasta');
    fs.writeFileSync(file, '>one\nanhpb\nANHP\n>two\naA\n');
    const out = [];
    for await (const e of readFasta(file)) out.push(e);
    assert.deepEqual(out, [{ name: 'one', sequence: 'anhpbANHP' }, { name: 'two', sequence: 'aA' }]);
});

test('coordinates hold one triple per residue, not per column', () => {
    const msa = tmp('coordinates-');
    const entriesFixture = {
        columns: 5,
        entries: [{ name: 'one', residueCount: 3 }, { name: 'two', residueCount: 4 }],
    };
    const coordinateFixture = {
        entries: [
            { name: 'one', ca: '0,0,0,1,1,1,2,2,2' },
            { name: 'two', ca: '0,0,0,1,1,1,2,2,2,3,3,3' },
        ],
    };
    fs.writeFileSync(path.join(msa, 'entries.json'), JSON.stringify(entriesFixture));
    fs.writeFileSync(path.join(msa, 'coordinates.json.gz'),
        zlib.gzipSync(Buffer.from(JSON.stringify(coordinateFixture))));
    const coords = readGzipJson(path.join(msa, 'coordinates.json.gz'));
    const entries = JSON.parse(fs.readFileSync(path.join(msa, 'entries.json'), 'utf8'));
    const totalColumns = entries.columns;
    assert.equal(totalColumns, 5);
    assert.equal(coords.entries.length, entries.entries.length);

    const residueCounts = new Map(entries.entries.map(e => [e.name, e.residueCount]));
    for (const entry of coords.entries) {
        // `ca` is a flat comma-joined list of x,y,z triples, ungapped.
        const values = entry.ca.split(',');
        assert.equal(values.length % 3, 0, `${entry.name}: not a whole number of triples`);
        const triples = values.length / 3;
        assert.equal(triples, residueCounts.get(entry.name), `${entry.name}: one triple per residue`);
        assert.notEqual(triples, totalColumns, `${entry.name}: a column index is not a coordinate index`);
        assert.ok(values.every(v => Number.isFinite(Number(v))), `${entry.name}: a coordinate is not numeric`);
    }
    // And the counts really do differ from the column count, or the assertion above proves nothing.
    assert.deepEqual([...residueCounts.values()], [3, 4]);
});
