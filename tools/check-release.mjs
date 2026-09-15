#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '..');

export function releaseMetadataErrors({ repositoryRoot, tag, repository }) {
    const errors = [];
    const manifest = JSON.parse(fs.readFileSync(
        path.join(repositoryRoot, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'));
    if (!tag) return ['tag is required'];
    if (tag !== `v${manifest.version}`) errors.push(`tag must equal v${manifest.version}; \
        received ${JSON.stringify(tag)}`);

    const changelog = fs.readFileSync(path.join(repositoryRoot, 'plugin', 'CHANGELOG.md'), 'utf8');
    const escapedVersion = manifest.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`^## ${escapedVersion} — \\d{4}-\\d{2}-\\d{2}$`, 'm').test(changelog)) {
        errors.push(`CHANGELOG must date ${manifest.version} instead of marking it unreleased`);
    }
    if (!repository) {
        errors.push('GITHUB_REPOSITORY is required to verify the public install instructions');
        return errors;
    }
    const readme = fs.readFileSync(path.join(repositoryRoot, 'README.md'), 'utf8');
    const provenance = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'plugin', 'mcp-version.json'), 'utf8'));
    for (const command of [
        `/plugin marketplace add ${repository}`,
        '/plugin install claude-in-marv@steinegger-lab',
        `https://github.com/${repository}/releases/download/v${manifest.version}/marv-api-v${provenance.version}.mcpb`,
        `Plugin ${manifest.version} requires MCPB ${provenance.version}.`,
    ]) {
        if (!readme.includes(command)) errors.push(`README is missing the public install command: ${command}`);
    }
    return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
    const errors = releaseMetadataErrors({
        repositoryRoot: root,
        tag: process.argv[2] || process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME,
        repository: process.env.GITHUB_REPOSITORY,
    });
    if (errors.length) {
        for (const error of errors) console.error(`Release: ${error}`);
        process.exit(1);
    }

    for (const tool of ['check-mcp-runtime.mjs', 'check-mcp-interface.mjs']) {
        const check = spawnSync(process.execPath, [path.join(root, 'tools', tool), '--required'], {
            stdio: 'inherit',
        });
        if (check.status !== 0) process.exit(check.status ?? 1);
    }

    const manifest = JSON.parse(fs.readFileSync(
        path.join(root, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'));
    console.log(`v${manifest.version}: release inputs validated`);
}
