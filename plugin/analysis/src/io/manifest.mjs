import fs from 'node:fs';
import path from 'node:path';
import { fail } from './errors.mjs';
import { confineExisting } from './paths.mjs';

// Confine support files even when `files[]` does not size-check them.
export const UNLISTED = Object.freeze(['manifest.json', 'READY', 'access.json']);
const UNLISTED_SET = new Set(UNLISTED);

// Confinement for an unlisted artifact file.
function confineUnlisted(root, name) {
    if (!fs.existsSync(path.join(root, name))) return;
    confineExisting(root, name);
}

// The five preflight checks, in order, stopping at the first failure.
export function preflight(artifactRoot) {
    const root = path.resolve(artifactRoot);

    if (!fs.existsSync(path.join(root, 'READY'))) fail('ARTIFACT_NOT_READY', { root });
    confineUnlisted(root, 'READY');

    confineUnlisted(root, 'manifest.json');
    const manifest = parseManifest(path.join(root, 'manifest.json'));

    checkArtifactId(manifest, root);
    const roles = indexRoles(manifest);
    checkBytes(manifest, root);

    return { root, manifest, roles };
}

function parseManifest(file) {
    let raw;
    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch (cause) {
        fail('MANIFEST_UNREADABLE', { file: path.basename(file), reason: cause.code ?? 'unreadable' });
    }
    let manifest;
    try {
        manifest = JSON.parse(raw);
    } catch {
        fail('MANIFEST_UNREADABLE', { file: path.basename(file), reason: 'not JSON' });
    }
    if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.files)) {
        fail('MANIFEST_UNREADABLE', { file: path.basename(file), reason: 'no files[]' });
    }
    checkDescriptors(manifest, path.basename(file));
    return manifest;
}

// Validate descriptors before reading fields or joining paths.
function checkDescriptors(manifest, file) {
    const refuse = (index, reason) => fail('MANIFEST_UNREADABLE', { file, reason, index });
    manifest.files.forEach((entry, index) => {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            refuse(index, 'a files[] entry is not an object');
        }
        if (typeof entry.role !== 'string' || entry.role === '') {
            refuse(index, 'a files[] entry has no role');
        }
        if (typeof entry.path !== 'string' || entry.path === '') {
            refuse(index, 'a files[] entry has no path');
        }
        if (!Number.isInteger(entry.bytes) || entry.bytes < 0) {
            refuse(index, 'a files[] entry declares no usable byte count');
        }
    });
}

// The manifest's artifactId must equal both the directory name and the descriptor's id.
function checkArtifactId(manifest, root) {
    const dirName = path.basename(root);
    if (manifest.artifactId !== dirName) {
        fail('ARTIFACT_ID_MISMATCH', { manifest: manifest.artifactId, directory: dirName });
    }
}

// role -> entries, in manifest order. A role can repeat, once per database.
function indexRoles(manifest) {
    const byRole = new Map();
    for (const entry of manifest.files) {
        if (!byRole.has(entry.role)) byRole.set(entry.role, []);
        byRole.get(entry.role).push(entry);
    }
    return byRole;
}

// Require each declared file to match its recorded size.
function checkBytes(manifest, root) {
    for (const entry of manifest.files) {
        if (UNLISTED_SET.has(entry.path)) continue;
        // confineExisting, not confine: this is the first touch of a declared file.
        const file = confineExisting(root, entry.path);
        let size;
        try {
            size = fs.statSync(file).size;
        } catch {
            fail('FILE_SIZE_MISMATCH', { path: entry.path, declared: entry.bytes, onDisk: null });
        }
        if (size !== entry.bytes) {
            fail('FILE_SIZE_MISMATCH', { path: entry.path, declared: entry.bytes, onDisk: size });
        }
    }
}
