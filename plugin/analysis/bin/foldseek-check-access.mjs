#!/usr/bin/env node
// Verify that this process can read the user-named shared directory.

import { probeSharedDirectory } from '../src/io/shared-dir.mjs';

const args = process.argv.slice(2);
const valid = args.length === 2 && args[0] === '--shared-root' && args[1] !== '';
if (!valid) {
    process.stderr.write(`${JSON.stringify({ access: {
        granted: false,
        reason: 'usage: foldseek-check-access --shared-root <dir>',
        action: 'Ask the user to name the shared directory for this session, then retry.',
    } })}\n`);
    process.exitCode = 2;
} else {
    const result = probeSharedDirectory(args[1]);
    const stream = result.granted ? process.stdout : process.stderr;
    stream.write(`${JSON.stringify({ access: result })}\n`);
    process.exitCode = result.granted ? 0 : 2;
}
