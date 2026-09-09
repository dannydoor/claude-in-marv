// The run harness: everything a subcommand needs done around it, done once.

import { preflight } from '../io/manifest.mjs';
import { resolveRole } from '../io/roles.mjs';
import { Warnings, AFFECTED_TABLE } from '../io/warnings.mjs';
import { buildResult, buildRun, writeRun } from '../io/envelope.mjs';
import { rosterLabels, validateRoster } from '../io/roster.mjs';
import { DIRECTIONS, usableDirection } from '../hit/rows.mjs';
import {
    parseArgs, required, optionalInteger, databaseSelector, refuse, repeatedValues,
    UNIVERSAL_FLAGS,
} from './args.mjs';
// Route all filesystem access through the guarded destination module.
import { resolveOutput, publish, artifactLocation } from './destination.mjs';
import { probeSharedDirectory, confineToSharedDirectory } from '../io/shared-dir.mjs';

export const acceptedFlags = spec => [...new Set([...UNIVERSAL_FLAGS, ...(spec.options ?? [])])].sort();

// The artifact is one query of one ticket.
function checkQueryIndex(manifest, requested) {
    if (requested === null) return;
    const carried = manifest.state?.queryIdx;
    if (carried === null || carried === undefined) {
        refuse('this artifact carries no query index', { requested });
    }
    if (requested !== carried) {
        refuse('this artifact is a different query of the ticket', { requested, artifact: carried });
    }
}

// `*`, a dbIndex, or a database id.
function selectDatabases(manifest, selector) {
    const labels = rosterLabels(manifest.databases, { source: 'manifest' });
    const declared = [...labels.keys()].sort((a, b) => a - b);
    if (selector.all) return declared;

    const byId = new Map([...labels].map(([dbIndex, id]) => [id, dbIndex]));
    const chosen = new Set();
    for (const want of selector.wanted) {
        if (/^\d+$/.test(want) && labels.has(Number(want))) { chosen.add(Number(want)); continue; }
        if (byId.has(want)) { chosen.add(byId.get(want)); continue; }
        refuse('no such database in this artifact', {
            requested: want, declared, ids: [...byId.keys()].sort(),
        });
    }
    return [...chosen].sort((a, b) => a - b);
}

const databaseRecords = manifest =>
    validateRoster(manifest.databases, { source: 'manifest' });

// Exclude and report databases whose result state is not complete.
function usable(selected, records, warnings, scope = {}) {
    const kept = [];
    for (const dbIndex of selected) {
        const record = records.get(dbIndex);
        const status = record?.status ?? null;
        if (status !== null && status !== 'COMPLETE') {
            warnings.add('DATABASE_ERROR', { scope: { ...scope, dbIndex }, facts: { status } });
            continue;
        }
        kept.push(dbIndex);
    }
    return kept;
}

// A second artifact root, for the one subcommand that compares two.
function secondSide(spec, given, warnings, checkedRoots) {
    const declared = required(given, 'against');
    const pre = preflight(artifactLocation(checkedRoots.get(declared)));
    const roles = {};
    for (const role of spec.roles) roles[role] = resolveRole(pre, role, { absent: null });
    const records = validateRoster(pre.manifest.databases, { source: 'manifest' });
    // Apply the same database filter to both artifacts.
    const kept = usable([...records.keys()].sort((a, b) => a - b), records, warnings, { side: 'against' });
    return {
        root: pre.root,
        manifest: pre.manifest,
        tool: pre.manifest.state?.tool ?? null,
        completeness: pre.manifest.completeness ?? null,
        labels: rosterLabels(pre.manifest.databases, { source: 'manifest' }),
        records,
        selected: kept,
        roles,
    };
}

// The intermediates of an explicit lineage chain.
function intermediates(given, checkedRoots) {
    return repeatedValues(given, 'via').map(declared => {
        const pre = preflight(artifactLocation(checkedRoots.get(declared)));
        return { artifactId: pre.manifest.artifactId, manifest: pre.manifest };
    });
}

export async function runSubcommand(spec, argv) {
    const given = parseArgs(argv, acceptedFlags(spec));
    // Validate non-filesystem arguments before access checks.
    const sample = optionalInteger(given, 'sample');
    const top = optionalInteger(given, 'top');
    const queryIdx = optionalInteger(given, 'query-idx');
    const declaredSharedRoot = required(given, 'shared-root');
    const shared = probeSharedDirectory(declaredSharedRoot);
    if (!shared.granted) {
        refuse('the shared directory is not accessible to this session', {
            requested: shared.requested, reason: shared.reason, action: shared.action,
        });
    }

    const declaredArtifactRoot = required(given, 'artifact-root');
    const declaredRoots = [declaredArtifactRoot];
    if (spec.against === true) {
        declaredRoots.push(required(given, 'against'), ...repeatedValues(given, 'via'));
    }
    const checkedRoots = new Map();
    for (const declared of declaredRoots) {
        const checked = confineToSharedDirectory(shared.sharedDir, declared);
        if (!checked.granted) {
            refuse('an artifact root is not accessible through the confirmed shared directory', {
                sharedRoot: shared.sharedDir, requested: checked.requested,
                reason: checked.reason, action: checked.action,
            });
        }
        checkedRoots.set(declared, checked.resolved);
    }
    const artifactRoot = checkedRoots.get(declaredArtifactRoot);
    const out = required(given, 'out');
    // Both inputs of a two-artifact run are checked for containment, not only the first.
    const target = resolveOutput(out, spec.against === true
        ? declaredRoots.map(root => checkedRoots.get(root))
        : artifactRoot);

    // The publisher resolved this already, and it is the only place allowed to.
    const pre = preflight(artifactLocation(artifactRoot));
    checkQueryIndex(pre.manifest, queryIdx);

    // Enforce role cardinality per subcommand.
    const roles = {};
    for (const role of spec.roles) {
        const absent = spec.requires === undefined
            ? null
            : (spec.requires.includes(role) ? 'required' : 'degrade');
        roles[role] = resolveRole(pre, role, { absent });
    }

    const warnings = new Warnings(sample === null ? {} : { sample });
    const records = databaseRecords(pre.manifest);
    const context = {
        root: pre.root,
        manifest: pre.manifest,
        tool: pre.manifest.state?.tool ?? null,
        mode: pre.manifest.state?.mode ?? null,
        ranking: pre.manifest.ranking ?? null,
        metricSemantics: pre.manifest.metricSemantics ?? {},
        completeness: pre.manifest.completeness ?? null,
        labels: rosterLabels(pre.manifest.databases, { source: 'manifest' }),
        records,
        selected: usable(selectDatabases(pre.manifest, databaseSelector(given)), records, warnings),
        roles,
        warnings,
        top,
        args: given,
    };
    // Present only for the subcommand that declares it, so no other context carries it.
    if (spec.against === true) context.against = secondSide(spec, given, warnings, checkedRoots);
    // Only two-artifact runs can carry lineage intermediates.
    if (spec.against === true) context.via = intermediates(given, checkedRoots);
    // Re-rank only on a field whose semantics the artifact declares.
    const sortField = given.get('sort') ?? null;
    if (sortField !== null && !Object.hasOwn(context.metricSemantics, sortField)) {
        refuse('this result declares no semantics for that field', {
            requested: sortField, declared: Object.keys(context.metricSemantics).sort(),
        });
    }
    // Declaring the field is not declaring an ordering.
    if (sortField !== null && !usableDirection(context.metricSemantics[sortField]?.direction)) {
        refuse('this result declares no usable ranking direction for that field', {
            requested: sortField,
            declared: context.metricSemantics[sortField]?.direction ?? null,
            usable: [...DIRECTIONS],
        });
    }

    const startedAt = new Date().toISOString();
    const { summary, tables = {} } = await spec.run(context);
    const finishedAt = new Date().toISOString();

    const input = {
        artifactId: pre.manifest.artifactId,
        ticket: pre.manifest.state?.ticket ?? null,
        queryIdx: pre.manifest.state?.queryIdx,
        roles: spec.roles,
    };
    // Normalised: what the run was asked to do, resolved, with no host path in it.
    const options = {
        databases: context.selected,
        sort: sortField,
        top,
        sample: warnings.sample,
    };
    // Record only selectors the caller supplied.
    for (const [flag, value] of Object.entries(context.selectors ?? {})) options[flag] = value;
    const files = Object.keys(tables).sort().map(name => ({ role: name, path: `tables/${name}.tsv` }));
    // Declare the affected-id table when it is written.
    if (warnings.affectedRows().length > 0) files.push({ role: 'warnings', path: AFFECTED_TABLE });

    const result = buildResult({
        analysis: spec.name, analysisVersion: spec.version, input, options, summary, files, warnings,
    });
    const run = buildRun({
        analysis: spec.name,
        analysisVersion: spec.version,
        tool: pre.manifest.state?.tool ?? null,
        serverNamespace: pre.manifest.state?.serverNamespace ?? null,
        input,
        options,
        roles: spec.roles,
        startedAt,
        finishedAt,
    });

    publish(target, staging => writeRun(staging, { run, result, tables, warnings }));
    return { result, files: ['result.json', 'run.json', ...files.map(f => f.path)] };
}
