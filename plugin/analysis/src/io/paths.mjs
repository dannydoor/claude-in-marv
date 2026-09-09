import fs from 'node:fs';
import path from 'node:path';
import { fail } from './errors.mjs';

// Lexical confinement: a joined path that escapes the root is refused, not clamped.
export function confine(root, relative) {
    const base = path.resolve(root);
    const resolved = path.resolve(base, relative);
    const rel = path.relative(base, resolved);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
        fail('PATH_OUTSIDE_ROOT', { root: base, requested: relative });
    }
    return resolved;
}

// Confinement for a path that exists and will be read.
export function confineExisting(root, relative) {
    const base = path.resolve(root);
    const resolved = confine(base, relative);

    let entry;
    try {
        entry = fs.lstatSync(resolved);
    } catch (cause) {
        fail('PATH_OUTSIDE_ROOT', {
            root: base, requested: relative, reason: cause.code ?? 'unreadable',
        });
    }
    if (entry.isSymbolicLink()) {
        fail('PATH_OUTSIDE_ROOT', { root: base, requested: relative, reason: 'symbolic link' });
    }
    if (!entry.isFile()) {
        fail('PATH_OUTSIDE_ROOT', { root: base, requested: relative, reason: 'not a regular file' });
    }

    const realBase = fs.realpathSync(base);
    const realTarget = fs.realpathSync(resolved);
    const rel = path.relative(realBase, realTarget);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
        fail('PATH_OUTSIDE_ROOT', {
            root: realBase, requested: relative, reason: 'resolves outside the root',
        });
    }
    return resolved;
}
