import fs from 'node:fs';
import path from 'node:path';

// Write atomically through a temporary sibling.
let seq = 0;

export function writeAtomic(file, contents) {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${seq++}.tmp`);
    try {
        fs.writeFileSync(tmp, contents);
        fs.renameSync(tmp, file);
    } catch (cause) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* the rename already consumed it */ }
        throw cause;
    }
}

// Trailing newline, two-space indent, key order as constructed.
export const writeJson = (file, value) => writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);

// Escape control characters in unquoted TSV cells.
const escapeField = value => {
    const text = String(value ?? '');
    // eslint-disable-next-line no-control-regex
    return text.replace(/[\u0000-\u001f\u007f\\]/g, character => {
        if (character === '\\') return '\\\\';
        if (character === '\t') return '\\t';
        if (character === '\n') return '\\n';
        if (character === '\r') return '\\r';
        return `\\x${character.charCodeAt(0).toString(16).padStart(2, '0')}`;
    });
};

export function writeTsv(file, header, rows) {
    const lines = [header.map(escapeField).join('\t')];
    for (const row of rows) lines.push(header.map(k => escapeField(row[k])).join('\t'));
    writeAtomic(file, `${lines.join('\n')}\n`);
}
