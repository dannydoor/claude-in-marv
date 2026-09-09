#!/usr/bin/env node
// Connect reusable CLI logic to process streams and exit status.

import { main } from '../src/cli/main.mjs';

let outputFailure = null;
const note = (name, cause) => {
    if (cause === null || cause === undefined || cause.code === 'EPIPE') return;
    outputFailure = outputFailure ?? { stream: name, reason: cause.code ?? 'unknown' };
};

// A closed pipe raises on the stream itself rather than on any one write.
process.stdout.on('error', cause => note('stdout', cause));
process.stderr.on('error', cause => note('stderr', cause));

// Each line is written and WAITED FOR.
const pending = [];
const emit = (stream, name, line) => {
    pending.push(new Promise(resolve => {
        try {
            stream.write(`${line}\n`, cause => { note(name, cause); resolve(); });
        } catch (cause) {
            note(name, cause);
            resolve();
        }
    }));
};

const code = await main(process.argv.slice(2), {
    stdout: line => emit(process.stdout, 'stdout', line),
    stderr: line => emit(process.stderr, 'stderr', line),
});
await Promise.all(pending);

// The run's own outcome decides the status.
if (outputFailure !== null && code === 0) {
    const report = JSON.stringify({ output: { problem: 'the result could not be reported', detail: outputFailure } });
    await new Promise(resolve => {
        try {
            process.stderr.write(`${report}\n`, () => resolve());
        } catch {
            resolve();
        }
    });
    process.exitCode = 1;
} else {
    process.exitCode = code;
}
