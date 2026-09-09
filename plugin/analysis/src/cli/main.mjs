// Map run outcomes to stable exit codes.

import { AnalysisError } from '../io/errors.mjs';
import { UsageError } from './args.mjs';
import { GROUPS, lookup, namesIn } from './registry.mjs';
import { runSubcommand } from './run.mjs';

export const EXIT = Object.freeze({ ok: 0, refused: 1, usage: 2 });

const usageBody = () => ({
    invocation: 'foldseek-analyze <group> <subcommand> --shared-root <dir> --artifact-root <dir> --out <dir>',
    groups: Object.fromEntries(GROUPS.map(group => [group, namesIn(group)])),
});

export async function main(argv, { stdout, stderr }) {
    const [group, subcommand, ...rest] = argv;

    if (group === undefined || group === '--help' || group === 'help') {
        stderr(JSON.stringify({ usage: { problem: 'no subcommand given', detail: usageBody() } }));
        return EXIT.usage;
    }
    if (subcommand === undefined || subcommand.startsWith('--')) {
        stderr(JSON.stringify({ usage: { problem: 'no subcommand given for this group', detail: usageBody() } }));
        return EXIT.usage;
    }
    const spec = lookup(group, subcommand);
    if (spec === null) {
        stderr(JSON.stringify({ usage: { problem: 'unknown subcommand', detail: { requested: `${group}/${subcommand}`, ...usageBody() } } }));
        return EXIT.usage;
    }

    try {
        const { result, files } = await runSubcommand(spec, rest);
        stdout(JSON.stringify({
            analysis: result.analysis,
            files,
            warnings: result.warnings.map(w => [w.code, w.level]),
        }));
        return EXIT.ok;
    } catch (cause) {
        if (cause instanceof UsageError) {
            stderr(JSON.stringify(cause.toJSON()));
            return EXIT.usage;
        }
        if (cause instanceof AnalysisError) {
            stderr(JSON.stringify(cause.toJSON()));
            return EXIT.refused;
        }
        throw cause;
    }
}
