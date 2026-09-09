// All filesystem access made by the CLI harness is centralised here.

import fs from 'node:fs';
import path from 'node:path';
import { refuse } from './args.mjs';
import { AnalysisError } from '../io/errors.mjs';

const attempt = (problem, detail, act) => {
    try {
        return act();
    } catch (cause) {
        // Preserve structured errors from the write operation.
        if (cause instanceof AnalysisError) throw cause;
        refuse(problem, { ...detail, reason: cause?.code ?? 'unusable' });
    }
};

const probing = (fallback, act) => {
    try {
        return act();
    } catch {
        return fallback;
    }
};

// Clean failed staging writes and report other failures as output refusals.
const committing = (staging, target, act) => {
    try {
        return act();
    } catch (cause) {
        probing(null, () => fs.rmSync(staging, { recursive: true, force: true }));
        if (cause instanceof AnalysisError) throw cause;
        if (cause?.code === 'ENOTEMPTY' || cause?.code === 'EEXIST') {
            refuse('the output directory was filled while the run was in progress', { out: target });
        }
        refuse('the output location cannot be written to', { out: target, reason: cause?.code ?? 'unusable' });
    }
};

const exists = target => probing(false, () => fs.existsSync(target));

// Detect names that exist even when their targets are unreachable.
const occupied = entry => probing(false, () => { fs.lstatSync(entry); return true; });

// Resolve paths through the same guarded filesystem boundary.
const located = (problem, detail, target) => attempt(problem, detail, () => path.resolve(target));

// Canonicalize a lexical path before containment checks.
function canonicalise(target) {
    const absolute = located('the output location cannot be resolved', { out: String(target) }, target);
    let current = absolute;
    const unresolved = [];
    // Each iteration removes one path segment.
    while (!exists(current) && path.dirname(current) !== current) {
        // A broken link still occupies its name.
        if (occupied(current)) {
            refuse('the output location cannot be resolved', {
                out: absolute, reason: 'a broken link is in the path',
            });
        }
        unresolved.unshift(path.basename(current));
        current = path.dirname(current);
    }
    const base = attempt('the output location cannot be resolved', { out: absolute },
        () => fs.realpathSync(current));
    return unresolved.length === 0 ? base : path.join(base, ...unresolved);
}

// Containment on two canonical paths: equal, or one below the other.
const contains = (outer, inner) => {
    // Both inputs are canonical absolute paths.
    const rel = attempt('the output location cannot be compared with the artifact',
        { artifactRoot: outer, out: inner }, () => path.relative(outer, inner));
    return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
};

// Return the canonical artifact root used by containment checks.
export const artifactLocation = artifactRoot =>
    located('the artifact location cannot be resolved', { artifactRoot: String(artifactRoot) }, artifactRoot);

// `artifactRoots` is one root or every root the run reads.
export function resolveOutput(out, artifactRoots) {
    const target = canonicalise(out);
    const roots = Array.isArray(artifactRoots) ? artifactRoots : [artifactRoots];
    for (const given of roots) {
        // Check containment only for existing artifact roots.
        const declared = artifactLocation(given);
        const root = exists(declared)
            ? attempt('the artifact location cannot be resolved', { artifactRoot: declared },
                () => fs.realpathSync(declared))
            : null;
        if (root === null) continue;
        // Never publish inside an input artifact.
        if (contains(root, target)) {
            refuse('the output directory is the artifact, or sits inside it', { artifactRoot: root, out: target });
        }
        // Never publish over a directory containing an input artifact.
        if (contains(target, root)) {
            refuse('the artifact sits inside the output directory', { artifactRoot: root, out: target });
        }
    }

    if (exists(target)) {
        const stat = attempt('the output location cannot be read', { out: target },
            () => fs.statSync(target));
        if (!stat.isDirectory()) refuse('the output path is not a directory', { out: target });
        // Refuse non-empty destinations to prevent mixed bundles.
        const entries = attempt('the output location cannot be read', { out: target },
            () => fs.readdirSync(target));
        if (entries.length > 0) {
            refuse('the output directory is not empty', { out: target, entries: [...entries].sort().slice(0, 5) });
        }
    }
    return target;
}

// Everything is written into a temporary sibling and renamed into place.
export function publish(target, write) {
    attempt('the output location cannot be created', { out: target }, () => {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        // Probe a new destination before staging.
        if (!exists(target)) {
            fs.mkdirSync(target, { recursive: false });
            fs.rmdirSync(target);
        }
    });

    // Stage beside the destination for an atomic rename.
    const staging = attempt('the output location cannot be created', { out: target },
        () => fs.mkdtempSync(path.join(path.dirname(target), '.foldseek-analyze-')));

    committing(staging, target, () => {
        write(staging);
        if (exists(target)) fs.rmdirSync(target);
        fs.renameSync(staging, target);
    });
}
