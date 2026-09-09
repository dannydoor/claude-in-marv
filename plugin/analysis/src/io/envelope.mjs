import path from 'node:path';
import { Warnings, AFFECTED_TABLE } from './warnings.mjs';
import { writeJson, writeTsv } from './write.mjs';

export const ENVELOPE_VERSION = 1;

// A host exposes each server tool under its own prefix.
export const logicalTool = name =>
    (typeof name === 'string' ? name.split(/__|\./).pop() : null);

// queryIdx is absent, not zero, for FoldMason and FoldDisco and for any not-ready unit.
function withQueryIdx(target, queryIdx) {
    if (queryIdx !== null && queryIdx !== undefined) target.queryIdx = queryIdx;
    return target;
}

// Keep result.json deterministic for equivalent runs.
export function buildResult({ analysis, analysisVersion, input, options = null, summary = {}, files = [], warnings = new Warnings() }) {
    const consumed = { artifactId: input.artifactId, ticket: input.ticket };
    withQueryIdx(consumed, input.queryIdx);
    consumed.roles = [...(input.roles ?? [])];
    const result = {
        analysis,
        analysisVersion,
        version: ENVELOPE_VERSION,
        input: consumed,
    };
    if (options !== null) result.options = options;
    result.summary = summary;
    result.files = files.map(f => ({ role: f.role, path: f.path }));
    result.warnings = warnings.toJSON();
    return result;
}

// Keep provenance and the only timestamp in run.json.
export function buildRun({ analysis, analysisVersion, tool, serverNamespace, input, options = null, roles, startedAt, finishedAt }) {
    const run = {
        analysis,
        analysisVersion,
        version: ENVELOPE_VERSION,
        tool: logicalTool(tool),
        serverNamespace,
        ticket: input.ticket,
        ...withQueryIdx({}, input.queryIdx),
        artifactId: input.artifactId,
        roles: [...roles],
    };
    if (options !== null) run.options = options;
    run.startedAt = startedAt;
    run.finishedAt = finishedAt;
    return run;
}

// Return one persistent run bundle with its tables.
export function writeRun(runDir, { run, result, tables = {}, warnings = null }) {
    writeJson(path.join(runDir, 'result.json'), result);
    writeJson(path.join(runDir, 'run.json'), run);
    for (const [name, table] of Object.entries(tables)) {
        writeTsv(path.join(runDir, 'tables', `${name}.tsv`), table.header, table.rows);
    }
    const affected = warnings ? warnings.affectedRows() : [];
    if (affected.length > 0) {
        // Reuse the warning table's canonical path.
        writeTsv(path.join(runDir, AFFECTED_TABLE), ['code', 'scope', 'id'], affected);
    }
}
