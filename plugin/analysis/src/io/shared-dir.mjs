import fs from 'node:fs';
import path from 'node:path';

// A shared directory is a capability of THIS session, not a path the plugin may infer.
export const CAPABILITY = Object.freeze({ FULL: 'full', SUMMARY_ONLY: 'summary-only' });
export const ACCESS_ACTION = 'Ask the user to grant or connect this session to the named shared directory and its exported artifacts, then retry.';
export const BOUNDARY_ACTION = 'Use an artifact root inside the confirmed shared directory, or ask the user to approve the exact directory that contains it, then retry.';

const ungranted = (requested, reason) => ({
    granted: false,
    capability: CAPABILITY.SUMMARY_ONLY,
    requested,
    sharedDir: null,
    reason,
    action: ACCESS_ACTION,
    unavailable: ['reading an exported artifact', 'every local analysis subcommand'],
});

export function probeSharedDirectory(candidate) {
    if (typeof candidate !== 'string' || candidate.trim() === '') {
        return ungranted(null, 'no shared directory was named for this session');
    }

    const requested = path.resolve(candidate);
    if (requested === path.parse(requested).root) {
        return ungranted(requested, 'a filesystem root is not an acceptable shared directory');
    }
    let stat;
    try {
        stat = fs.statSync(requested);
    } catch (cause) {
        return ungranted(requested, cause.code === 'ENOENT'
            ? 'the named shared directory does not exist here'
            : 'the named shared directory is not reachable by this session');
    }
    if (!stat.isDirectory()) return ungranted(requested, 'the named shared path is not a directory');

    // This is an effective-access check, not a permission-bit check.
    try {
        fs.accessSync(requested, fs.constants.R_OK | fs.constants.X_OK);
        fs.readdirSync(requested);
        const sharedDir = fs.realpathSync(requested);
        return {
            granted: true, capability: CAPABILITY.FULL, requested, sharedDir, reason: null, action: null,
        };
    } catch {
        return ungranted(requested, 'the shared directory is not readable by this session');
    }
}

const outside = (base, target) => {
    const rel = path.relative(base, target);
    return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
};

// Every artifact root read by a run must be under the directory whose access was confirmed.
export function confineToSharedDirectory(sharedDir, candidate) {
    const requested = path.resolve(candidate);
    let resolved = requested;
    try {
        resolved = fs.realpathSync(requested);
        fs.accessSync(resolved, fs.constants.R_OK | fs.constants.X_OK);
        if (!fs.statSync(resolved).isDirectory()) {
            return {
                granted: false, requested, resolved,
                reason: 'the artifact root is not a directory', action: BOUNDARY_ACTION,
            };
        }
        fs.readdirSync(resolved);
    } catch (cause) {
        if (cause.code !== 'ENOENT') {
            return {
                granted: false, requested, resolved: null,
                reason: 'the artifact root is not reachable by this session', action: ACCESS_ACTION,
            };
        }
    }
    if (outside(sharedDir, resolved)) {
        return {
            granted: false, requested, resolved,
            reason: 'the artifact root is outside the confirmed shared directory', action: BOUNDARY_ACTION,
        };
    }
    return { granted: true, requested, resolved, reason: null, action: null };
}
