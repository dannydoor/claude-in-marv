// Structured IO errors for manifest, path, roster and stream guards.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { preflight } from '../../plugin/analysis/src/io/manifest.mjs';
import { confine, confineExisting } from '../../plugin/analysis/src/io/paths.mjs';
import { validateRoster, manifestCounts } from '../../plugin/analysis/src/io/roster.mjs';
import { readJsonl, readFasta, readGzipJson, readJson } from '../../plugin/analysis/src/io/streams.mjs';
import { Warnings } from '../../plugin/analysis/src/io/warnings.mjs';
import { tmp } from '../support/temp.mjs';

// Asserts the structured code, and — the half that matters for a `void(` mutant — that the call
// actually threw rather than returning a half-built value.
const raises = (code, fn, message) => {
    let threw = false;
    try { fn(); } catch (e) {
        threw = true;
        assert.equal(e.code, code, `${message}: expected ${code}, got ${e.code ?? e.name}`);
        assert.equal(e.name, 'AnalysisError', `${message}: not a structured error`);
    }
    assert.ok(threw, `${message}: returned instead of raising ${code}`);
};

// ───────────────────────────────────────────────────────────────── manifest: parse guards

// An artifact whose manifest.json holds arbitrary text. READY is present, so preflight gets past the
// readiness check and reaches the parse.
function artifactWithManifest(text) {
    const dir = path.join(tmp('artifact-'), 'A-1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'READY'), '');
    fs.writeFileSync(path.join(dir, 'manifest.json'), text);
    return dir;
}

// Every shape other than an object with a files array must fail with a structured error.
const UNPARSEABLE_MANIFESTS = [
    ['not JSON at all', '{ nope'],
    ['empty file', ''],
    ['JSON null', 'null'],
    ['JSON true', 'true'],
    ['JSON number', '42'],
    ['JSON string', '"A-1"'],
    ['JSON array', '[]'],
    ['object with no files key', '{"artifactId":"A-1"}'],
    ['object whose files is an object', '{"artifactId":"A-1","files":{}}'],
    ['object whose files is a string', '{"artifactId":"A-1","files":"none"}'],
    ['object whose files is null', '{"artifactId":"A-1","files":null}'],
];

test('every unparseable manifest raises MANIFEST_UNREADABLE, never a bare TypeError', () => {
    for (const [label, text] of UNPARSEABLE_MANIFESTS) {
        raises('MANIFEST_UNREADABLE', () => preflight(artifactWithManifest(text)), label);
    }
});

test('a missing manifest raises MANIFEST_UNREADABLE and a missing READY raises ARTIFACT_NOT_READY', () => {
    const noManifest = path.join(tmp('artifact-'), 'A-1');
    fs.mkdirSync(noManifest, { recursive: true });
    fs.writeFileSync(path.join(noManifest, 'READY'), '');
    raises('MANIFEST_UNREADABLE', () => preflight(noManifest), 'manifest absent');

    // READY is checked first: an artifact with no READY must not be parsed at all.
    const noReady = path.join(tmp('artifact-'), 'A-1');
    fs.mkdirSync(noReady, { recursive: true });
    fs.writeFileSync(path.join(noReady, 'manifest.json'), '{ nope');
    raises('ARTIFACT_NOT_READY', () => preflight(noReady), 'READY absent, malformed manifest present');
});

// ───────────────────────────────────────────────────────────────── paths: confinement guards

test('confineExisting refuses an entry it cannot lstat', () => {
    const root = tmp('root-');
    raises('PATH_OUTSIDE_ROOT', () => confineExisting(root, 'absent.jsonl'), 'missing file');
    raises('PATH_OUTSIDE_ROOT', () => confineExisting(root, 'no/such/dir/f.jsonl'), 'missing parent');
    // A directory is inside the root and lstat-able, but is not a readable role file.
    fs.mkdirSync(path.join(root, 'sub'));
    raises('PATH_OUTSIDE_ROOT', () => confineExisting(root, 'sub'), 'directory, not a regular file');
});

test('confine refuses an escape and accepts an in-root path', () => {
    const root = tmp('root-');
    for (const rel of ['../outside', '/etc/passwd', '../', 'a/../../b']) {
        raises('PATH_OUTSIDE_ROOT', () => confine(root, rel), rel);
    }
    assert.equal(confine(root, 'a/b.jsonl'), path.join(root, 'a/b.jsonl'));
});

// ───────────────────────────────────────────────────────────────── roster: entry-shape guards

test('a roster entry that is not an object raises DATABASE_ROSTER_INVALID', () => {
    // Decision 7 lists absent, non-array, bad and repeated dbIndex, and bad parsedRows. The entry-shape
    // guard was in the module and in no test: as a mutant it slipped through and then read a property
    // of null one line later.
    for (const entry of [null, undefined, 'db-0', 0, 1, true, false]) {
        raises('DATABASE_ROSTER_INVALID',
            () => validateRoster([entry], { source: 'manifest' }), JSON.stringify(entry) ?? 'undefined');
        raises('DATABASE_ROSTER_INVALID',
            () => manifestCounts({ databases: [entry] }), `manifestCounts ${JSON.stringify(entry)}`);
    }
    // A valid entry beside an invalid one still fails: the loop must not stop at the first good entry.
    raises('DATABASE_ROSTER_INVALID',
        () => validateRoster([{ dbIndex: 0 }, null], { source: 'manifest' }), 'good then bad');
});

test('the manifest total is compared only when it is an integer', () => {
    // The guard is deliberate: an alignment declares an empty roster and a total that counts entries
    // rather than rows, so a non-integer or absent total is not a disagreement to report. Widening it
    // to "defined" turns a well-formed artifact into a rejected one.
    const rows = [{ dbIndex: 0, parsedRows: 5 }, { dbIndex: 1, parsedRows: 5 }];
    for (const declaredTotal of ['10', null, undefined, 10.5, {}, []]) {
        const counts = manifestCounts({ databases: rows, counts: { parsedRows: declaredTotal } });
        assert.equal(counts.size, 2, `declaredTotal=${JSON.stringify(declaredTotal)} must be ignored`);
    }
    // An integer total IS compared, in both directions.
    assert.equal(manifestCounts({ databases: rows, counts: { parsedRows: 10 } }).size, 2);
    raises('DATABASE_ROSTER_INVALID',
        () => manifestCounts({ databases: rows, counts: { parsedRows: 11 } }), 'sum disagrees');
});

// ───────────────────────────────────────────────────────────────── streams: parse guards

const fileWith = (contents, name = 'x') => {
    const dir = tmp('stream-');
    const file = path.join(dir, name);
    fs.writeFileSync(file, contents);
    return file;
};

test('readJson raises PARSE_FAILED rather than returning undefined', () => {
    // readJson had no test of any kind. Dropping its guard made it return undefined, and a caller then
    // read a field of undefined far from the cause.
    raises('PARSE_FAILED', () => readJson(fileWith('{ nope')), 'not JSON');
    raises('PARSE_FAILED', () => readJson(fileWith('')), 'empty');
    raises('PARSE_FAILED', () => readJson('/nonexistent/x.json'), 'missing file');
    assert.deepEqual(readJson(fileWith('{"a":1}')), { a: 1 });
});

test('readGzipJson raises PARSE_FAILED on both a gunzip and a JSON failure', () => {
    raises('PARSE_FAILED', () => readGzipJson(fileWith('not gzipped at all')), 'not gzip');
    raises('PARSE_FAILED', () => readGzipJson(fileWith(zlib.gzipSync('{ nope'))), 'gunzips to non-JSON');
    raises('PARSE_FAILED', () => readGzipJson('/nonexistent/x.json.gz'), 'missing file');
    assert.deepEqual(readGzipJson(fileWith(zlib.gzipSync('{"a":[1,2]}'))), { a: [1, 2] });
});

test('readJsonl raises MALFORMED_ROW with a line number, and skips blank lines', async () => {
    const drain = async file => { const out = []; for await (const r of readJsonl(file)) out.push(r); return out; };
    assert.deepEqual(await drain(fileWith('{"a":1}\n\n{"a":2}\n')), [{ a: 1 }, { a: 2 }]);
    for (const [label, text] of [['unparseable line', '{"a":1}\n{ nope\n'],
        ['a scalar line', '5\n'], ['a null line', 'null\n'], ['an array line', '[1]\n']]) {
        let code = null;
        try { await drain(fileWith(text)); } catch (e) { code = e.code; }
        assert.equal(code, 'MALFORMED_ROW', label);
    }
});

test('readFasta raises PARSE_FAILED on a sequence before any header', async () => {
    const drain = async file => { const out = []; for await (const r of readFasta(file)) out.push(r); return out; };
    assert.deepEqual(await drain(fileWith('>a\nSEQ\nMORE\n>b\nX\n')),
        [{ name: 'a', sequence: 'SEQMORE' }, { name: 'b', sequence: 'X' }]);
    let code = null;
    try { await drain(fileWith('SEQ\n>a\nX\n')); } catch (e) { code = e.code; }
    assert.equal(code, 'PARSE_FAILED', 'sequence before header');
});

// ───────────────────────────────────────────────────────────────── warnings: table ordering

test('the warnings table is sorted by code, then scope, then id', () => {
    // toJSON's group order was already gated; affectedRows' SECOND sort key was not, so the table
    // beside result.json could order two scopes of one code by arrival. Both are output bytes.
    const build = order => {
        const w = new Warnings();
        for (const [dbIndex, id] of order) w.add('ZERO_HIT_DATABASE', { scope: { dbIndex }, id });
        w.add('DATABASE_ERROR', { scope: { dbIndex: 9 }, id: 'z' });
        return w.affectedRows();
    };
    const forward = build([[3, 'y'], [3, 'x'], [1, 'b'], [2, 'm'], [1, 'a']]);
    const shuffled = build([[1, 'a'], [2, 'm'], [3, 'x'], [1, 'b'], [3, 'y']]);
    assert.deepEqual(forward, shuffled, 'the table must not depend on arrival order');
    assert.deepEqual(forward.map(r => `${r.code}|${r.scope}|${r.id}`), [
        'DATABASE_ERROR|{"dbIndex":9}|z',
        'ZERO_HIT_DATABASE|{"dbIndex":1}|a',
        'ZERO_HIT_DATABASE|{"dbIndex":1}|b',
        'ZERO_HIT_DATABASE|{"dbIndex":2}|m',
        'ZERO_HIT_DATABASE|{"dbIndex":3}|x',
        'ZERO_HIT_DATABASE|{"dbIndex":3}|y',
    ]);
});

// Additional integrity regressions.

test('a role file with APPENDED bytes fails the size check, not only a truncated one', () => {
    // Appended and truncated role files are both corrupt and must report their on-disk size.
    const manifest = declared => JSON.stringify({
        artifactId: 'A-1',
        files: [{ role: 'rows', path: 'search/db-0.rows.jsonl', bytes: declared, rows: 1, dbIndex: 0 }],
        databases: [{ dbIndex: 0, id: 'd', parsedRows: 1 }],
        counts: { parsedRows: 1 },
    });
    const stage = (declared, onDisk) => {
        const dir = path.join(tmp('artifact-'), 'A-1');
        fs.mkdirSync(path.join(dir, 'search'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'READY'), '');
        fs.writeFileSync(path.join(dir, 'manifest.json'), manifest(declared));
        fs.writeFileSync(path.join(dir, 'search', 'db-0.rows.jsonl'), onDisk);
        return dir;
    };
    const facts = dir => { try { preflight(dir); return null; } catch (e) { return e.facts; } };

    // appended: on disk is LARGER than declared
    const grown = facts(stage(2, '{}{}{}{}'));
    assert.ok(grown, 'an appended role file must be refused');
    assert.equal(grown.declared, 2);
    assert.equal(grown.onDisk, 8, 'the real on-disk size is reported, not a clamp');
    raises('FILE_SIZE_MISMATCH', () => preflight(stage(2, '{}{}{}{}')), 'appended');

    // truncated: the direction that was already covered, kept so both are pinned together
    raises('FILE_SIZE_MISMATCH', () => preflight(stage(8, '{}')), 'truncated');
    // and an exact match still passes, so the check is not simply always failing
    preflight(stage(2, '{}'));
});

test('an unlisted artifact file is confined too — a symlinked manifest or READY is refused', () => {
    // Manifest and READY are confined even though they are not listed as role files.
    const outside = tmp('outside-');
    const stage = ({ linkManifest = false, linkReady = false } = {}) => {
        const dir = path.join(tmp('artifact-'), 'A-1');
        fs.mkdirSync(path.join(dir, 'search'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'search', 'db-0.rows.jsonl'), '{}');
        const body = JSON.stringify({
            artifactId: 'A-1',
            files: [{ role: 'rows', path: 'search/db-0.rows.jsonl', bytes: 2, rows: 1, dbIndex: 0 }],
            databases: [{ dbIndex: 0, id: 'd', parsedRows: 1 }],
            counts: { parsedRows: 1 },
            state: { ticket: 'TICKET-FROM-OUTSIDE-THE-ROOT' },
        });
        if (linkManifest) {
            const target = path.join(outside, `m${Math.random()}.json`);
            fs.writeFileSync(target, body);
            fs.symlinkSync(target, path.join(dir, 'manifest.json'));
        } else {
            fs.writeFileSync(path.join(dir, 'manifest.json'), body);
        }
        if (linkReady) {
            const target = path.join(outside, `R${Math.random()}`);
            fs.writeFileSync(target, '');
            fs.symlinkSync(target, path.join(dir, 'READY'));
        } else {
            fs.writeFileSync(path.join(dir, 'READY'), '');
        }
        return dir;
    };

    // The defect as it was: an out-of-root manifest supplied the ticket and server namespace that the
    // envelope then recorded as this artifact's provenance.
    raises('PATH_OUTSIDE_ROOT', () => preflight(stage({ linkManifest: true })), 'symlinked manifest.json');
    // READY is the only proof a directory is whole, so a symlink must not be able to supply that proof.
    raises('PATH_OUTSIDE_ROOT', () => preflight(stage({ linkReady: true })), 'symlinked READY');
    raises('PATH_OUTSIDE_ROOT', () => preflight(stage({ linkManifest: true, linkReady: true })), 'both');

    // A directory at one of those names is not a regular file either.
    const asDir = stage();
    fs.rmSync(path.join(asDir, 'manifest.json'));
    fs.mkdirSync(path.join(asDir, 'manifest.json'));
    raises('PATH_OUTSIDE_ROOT', () => preflight(asDir), 'manifest.json is a directory');

    // Control: real files still pass, so the confinement is refusing indirection and not the names.
    const real = preflight(stage());
    assert.equal(real.manifest.artifactId, 'A-1');

    // And absence still reports its own code rather than a confinement error — the distinction the fix
    // has to preserve.
    const noReady = stage();
    fs.rmSync(path.join(noReady, 'READY'));
    raises('ARTIFACT_NOT_READY', () => preflight(noReady), 'READY absent');
    const noManifest = stage();
    fs.rmSync(path.join(noManifest, 'manifest.json'));
    raises('MANIFEST_UNREADABLE', () => preflight(noManifest), 'manifest absent');
});
