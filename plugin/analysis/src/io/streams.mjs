import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { fail } from './errors.mjs';
import { AnalysisError } from './errors.mjs';

// A valid size does not guarantee a streamed file can be read.
const readFailure = (cause, file) => {
    if (cause instanceof AnalysisError) throw cause;
    fail('PARSE_FAILED', { file, reason: cause?.code ?? 'unreadable' });
};

// Row and column files are streamed, never fully buffered.

// JSONL: one JSON object per line, blank lines skipped.
export async function* readJsonl(file, { label = null } = {}) {
    const rl = readline.createInterface({
        input: fs.createReadStream(file),
        crlfDelay: Infinity,
    });
    let lineNo = 0;
    try {
        for await (const line of rl) {
            lineNo += 1;
            if (line.trim() === '') continue;
            let row;
            try {
                row = JSON.parse(line);
            } catch {
                fail('MALFORMED_ROW', { file: label ?? file, line: lineNo });
            }
            // One JSON *object* per line.
            if (row === null || typeof row !== 'object' || Array.isArray(row)) {
                fail('MALFORMED_ROW', { file: label ?? file, line: lineNo, reason: 'not an object' });
            }
            yield row;
        }
    } catch (cause) {
        readFailure(cause, label ?? file);
    } finally {
        rl.close();
    }
}

// Join FASTA sequence lines without changing case.
export async function* readFasta(file, { label = null } = {}) {
    const rl = readline.createInterface({
        input: fs.createReadStream(file),
        crlfDelay: Infinity,
    });
    let name = null;
    let chunks = [];
    try {
        for await (const line of rl) {
            if (line.startsWith('>')) {
                if (name !== null) yield { name, sequence: chunks.join('') };
                name = line.slice(1).trim();
                chunks = [];
            } else if (line.trim() !== '') {
                if (name === null) fail('PARSE_FAILED', { file: label ?? file, reason: 'sequence before header' });
                chunks.push(line.trim());
            }
        }
        if (name !== null) yield { name, sequence: chunks.join('') };
    } catch (cause) {
        readFailure(cause, label ?? file);
    } finally {
        rl.close();
    }
}

// A gzipped JSON payload, read whole because it is one document.
export function readGzipJson(file, { label = null } = {}) {
    let text;
    try {
        text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
    } catch (cause) {
        fail('PARSE_FAILED', { file: label ?? file, reason: cause.code ?? 'gunzip failed' });
    }
    try {
        return JSON.parse(text);
    } catch {
        fail('PARSE_FAILED', { file: label ?? file, reason: 'not JSON' });
    }
}

export function readJson(file, { label = null } = {}) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (cause) {
        fail('PARSE_FAILED', { file: label ?? file, reason: cause.name === 'SyntaxError' ? 'not JSON' : (cause.code ?? 'unreadable') });
    }
}
