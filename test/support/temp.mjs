import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const created = [];
let armed = false;

function remove(dir) {
    try { fs.chmodSync(dir, 0o700); } catch { /* already absent */ }
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() && !entry.isSymbolicLink()) remove(path.join(dir, entry.name));
        }
    } catch { /* best-effort cleanup */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* do not mask a test result */ }
}

export function sweepTemporaries() {
    if (process.env.FOLDSEEK_KEEP_TMP === '1') return;
    while (created.length > 0) remove(created.pop());
}

export function tmp(prefix = 'foldseek-test-') {
    if (!armed) {
        armed = true;
        process.on('exit', sweepTemporaries);
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    created.push(dir);
    return dir;
}
