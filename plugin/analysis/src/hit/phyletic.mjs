// Clade counts, coverage, evenness and sequence-identity ranges for exported hits.

import { readJson } from '../io/streams.mjs';
import { confineExisting } from '../io/paths.mjs';
import { optionalPositiveInteger } from '../cli/args.mjs';
import { forEachRow, queryCoverage, round } from './rows.mjs';

const RANKS = Object.freeze(['superkingdom', 'kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species']);

export const phyletic = {
    name: 'hit/phyletic',
    version: 1,
    roles: ['rows', 'taxonomy'],
    options: ['db', 'taxon'],

    async run(context) {
        const taxon = optionalPositiveInteger(context.args, 'taxon');
        if (taxon !== null) context.selectors = { ...(context.selectors ?? {}), taxon };
        const rowUnits = new Map(context.roles.rows.units.map(u => [u.dbIndex, u]));
        const taxUnits = new Map(context.roles.taxonomy.units.map(u => [u.dbIndex, u]));

        const state = {
            included: [], excluded: [], cladeHits: new Map(), identities: new Map(),
            labels: new Map(), attributed: 0, totalRows: 0, treeRows: 0, totalNodes: 0,
            taxon, taxonDatabases: [], taxonHits: [],
        };

        for (const dbIndex of context.selected) {
            await oneDatabase(context, state, {
                dbIndex, ranks: RANKS,
                rowUnit: rowUnits.get(dbIndex), taxUnit: taxUnits.get(dbIndex),
            });
        }

        // Keep tree presence separate from row attribution.
        const coverage = {
            totalRows: state.totalRows,
            treeRows: state.treeRows,
            treeFraction: state.totalRows === 0 ? 0 : round(state.treeRows / state.totalRows, 3),
            attributedRows: state.attributed,
            attributedFraction: state.totalRows === 0 ? 0 : round(state.attributed / state.totalRows, 3),
        };
        if (state.totalRows > 0 && (state.excluded.length > 0 || state.attributed < state.treeRows)) {
            context.warnings.add('LOW_TAXONOMY_COVERAGE', {
                facts: {
                    coveredRows: state.treeRows,
                    totalRows: state.totalRows,
                    coveredFraction: coverage.treeFraction,
                    attributedRows: state.attributed,
                    attributedFraction: coverage.attributedFraction,
                    includedDatabases: state.included.map(d => d.dbIndex),
                },
            });
        }

        const byRank = groupByRank(state.cladeHits, RANKS, state.attributed, state.identities);
        const top = RANKS[0];
        const breadth = byRank.find(entry => entry.rank === top) ?? null;

        const summary = {
            treeDatabases: state.included,
            excludedDatabases: state.excluded,
            // Report contributors whose tree resolves no rows as named empty profiles.
            attributedNothing: state.included.filter(d => d.attributed === 0).map(d => d.dbIndex),
            coverage,
            rowsAttributed: state.attributed,
            rowsInTreeDatabases: state.treeRows,
            totalRows: state.totalRows,
            totalNodes: state.totalNodes,
            breadth: breadth === null
                ? { rank: top, distinct: 0, clades: [] }
                : { rank: top, distinct: breadth.clades.length, clades: breadth.clades },
            evenness: evennessOf(breadth?.clades ?? []),
            rankCounts: Object.fromEntries(byRank.map(entry => [entry.rank, entry.clades.length])),
            byRank,
            // Without a tree, report only the row labels.
            treeAbsent: state.included.length === 0,
            labelHistogram: state.included.length === 0 ? labelTally(state.labels) : null,
            claim: state.included.length === 0
                ? 'no tree was available, so this is a label tally and not a clade traversal'
                : 'clade claims are restricted to the databases that contributed a tree',
            ...(taxon === null ? {} : { taxonFilter: taxonSummary(state) }),
        };

        const tables = { clades: cladesTable(byRank) };
        if (taxon !== null) tables['taxon-hits'] = taxonHitsTable(state.taxonHits);
        return { summary, tables };
    },
};

async function oneDatabase(context, state, { dbIndex, ranks, rowUnit, taxUnit }) {
    const record = context.records.get(dbIndex);
    const rows = rowUnit && rowUnit.path !== null ? rowUnit.rows ?? 0 : 0;
    state.totalRows += rows;

    const declares = record?.taxonomyTree === true;
    if (!declares || !taxUnit || taxUnit.path === null) {
        await degrade(context, state, { dbIndex, record, rows, rowUnit, reason: declares
            ? 'no taxonomy report came back for this database'
            : 'this result declares no taxonomy tree for this database' });
        return;
    }

    // A report that does not parse is a damaged artifact and raises.
    const report = readJson(confineExisting(context.root, taxUnit.path), { label: taxUnit.path });
    const index = parentIndex(report);
    if (index.size === 0) {
        await degrade(context, state, {
            dbIndex, record, rows, rowUnit,
            reason: 'the taxonomy report holds no usable node',
        });
        return;
    }
    state.totalNodes += index.size;
    const selectedNode = state.taxon === null ? null : index.get(state.taxon) ?? null;

    let assigned = 0;
    let matched = 0;
    await forEachRow(context.root, rowUnit, (row, position) => {
        const lineage = ancestry(index, row.taxId);
        if (lineage.length === 0) return;
        assigned += 1;
        for (const node of lineage) {
            if (!ranks.includes(node.rank)) continue;
            const key = `${node.rank} ${node.taxId}`;
            if (!state.cladeHits.has(key)) {
                state.cladeHits.set(key, { rank: node.rank, taxId: node.taxId, name: node.name, hits: 0 });
                state.identities.set(key, []);
            }
            state.cladeHits.get(key).hits += 1;
            if (Number.isFinite(row.seqId)) state.identities.get(key).push(row.seqId);
        }
        if (state.taxon !== null) {
            const distance = lineage.findIndex(node => node.taxId === state.taxon);
            if (distance !== -1) {
                matched += 1;
                state.taxonHits.push(taxonHit(context, {
                    row, position, dbIndex, record, selectedNode, distance, requestedTaxId: state.taxon,
                }));
            }
        }
    });

    state.attributed += assigned;
    state.treeRows += rows;
    state.included.push({ dbIndex, id: record?.id ?? null, rows, attributed: assigned, nodes: index.size });
    if (state.taxon !== null) {
        state.taxonDatabases.push({
            dbIndex,
            id: record?.id ?? null,
            presentInTree: selectedNode !== null,
            name: selectedNode?.name ?? null,
            rank: selectedNode?.rank ?? null,
            matchedRows: matched,
        });
    }
}

// Handle every unavailable-tree path consistently.
async function degrade(context, state, { dbIndex, record, rows, rowUnit, reason }) {
    state.excluded.push({ dbIndex, id: record?.id ?? null, rows, reason });
    context.warnings.add('NO_TAXONOMY_TREE', { scope: { dbIndex }, facts: { reason } });
    if (rowUnit && rowUnit.path !== null) {
        await forEachRow(context.root, rowUnit, row => {
            const label = row.taxName ?? 'unknown';
            state.labels.set(label, (state.labels.get(label) ?? 0) + 1);
        });
    }
}

// Index taxonomy nodes once for local ancestry walks.
function parentIndex(report) {
    const index = new Map();
    for (const node of report?.nodes ?? []) {
        if (!Number.isInteger(node?.taxId)) continue;
        index.set(node.taxId, {
            taxId: node.taxId,
            name: node.name ?? null,
            rank: node.rank ?? null,
            parentTaxId: Number.isInteger(node.parentTaxId) ? node.parentTaxId : null,
        });
    }
    return index;
}

// The lineage of one row, nearest first.
function ancestry(index, taxId) {
    const seen = new Set();
    const lineage = [];
    let current = taxId;
    while (Number.isInteger(current) && index.has(current) && !seen.has(current)) {
        seen.add(current);
        const node = index.get(current);
        lineage.push(node);
        current = node.parentTaxId;
    }
    return lineage;
}

function groupByRank(cladeHits, ranks, attributed, identities) {
    const byRank = new Map(ranks.map(rank => [rank, []]));
    for (const clade of cladeHits.values()) {
        if (!byRank.has(clade.rank)) continue;
        byRank.get(clade.rank).push({
            ...clade,
            fraction: attributed === 0 ? 0 : round(clade.hits / attributed, 4),
            ...identitySummary(clade, identities),
        });
    }
    return ranks.map(rank => ({
        rank,
        clades: byRank.get(rank).sort((a, b) => b.hits - a.hits
            || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    }));
}

// Compute Shannon evenness across top-rank clades.
function evennessOf(clades) {
    const total = clades.reduce((sum, clade) => sum + clade.hits, 0);
    if (clades.length < 2 || total === 0) return null;
    let entropy = 0;
    for (const clade of clades) {
        const share = clade.hits / total;
        if (share > 0) entropy -= share * Math.log(share);
    }
    return round(entropy / Math.log(clades.length), 3);
}

function identitySummary(clade, identities) {
    const values = [...(identities.get(`${clade.rank} ${clade.taxId}`) ?? [])].sort((a, b) => a - b);
    const at = p => (values.length === 0 ? null : values[Math.floor((values.length - 1) * p)]);
    return {
        identityN: values.length,
        minSeqId: at(0),
        medianSeqId: at(0.5),
        maxSeqId: at(1),
    };
}

const labelTally = labels => [...labels]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

const cladesTable = byRank => ({
    header: ['rank', 'taxId', 'name', 'hits', 'fraction', 'identityN', 'minSeqId', 'medianSeqId', 'maxSeqId'],
    rows: byRank.flatMap(entry => entry.clades.map(clade => ({
        rank: entry.rank, taxId: clade.taxId, name: clade.name,
        hits: clade.hits, fraction: clade.fraction, identityN: clade.identityN,
        minSeqId: clade.minSeqId, medianSeqId: clade.medianSeqId, maxSeqId: clade.maxSeqId,
    }))),
});

function taxonSummary(state) {
    const ancestryAvailable = state.included.length > 0;
    const assessmentComplete = state.totalRows === 0
        || (ancestryAvailable && state.attributed === state.totalRows);
    return {
        taxId: state.taxon,
        ancestryAvailable,
        assessmentComplete,
        assessedRows: state.attributed,
        unassessedRows: state.totalRows - state.attributed,
        presentInTree: state.taxonDatabases.some(database => database.presentInTree),
        matchedRows: ancestryAvailable || state.totalRows === 0 ? state.taxonHits.length : null,
        databases: state.taxonDatabases,
        claim: ancestryAvailable
            ? 'reported membership uses exported taxId ancestry; taxName is display only'
            : 'no usable taxonomy tree was available, so descendant membership was not inferred',
    };
}

function taxonHit(context, { row, position, dbIndex, record, selectedNode, distance, requestedTaxId }) {
    const field = context.ranking?.field ?? null;
    const coverage = queryCoverage(row);
    return {
        id: row.id ?? null,
        dbIndex,
        db: record?.id ?? null,
        rankInDatabase: position,
        target: row.target ?? null,
        rowTaxId: Number.isInteger(row.taxId) ? row.taxId : null,
        taxName: row.taxName ?? null,
        requestedTaxId,
        requestedTaxName: selectedNode?.name ?? null,
        requestedTaxRank: selectedNode?.rank ?? null,
        distanceToTaxon: distance,
        rankingField: field,
        rankingValue: field === null ? null : row[field] ?? null,
        seqId: row.seqId ?? null,
        coverage: coverage === null ? null : round(coverage, 3),
        description: row.description ?? '',
    };
}

const taxonHitsTable = rows => ({
    header: [
        'id', 'dbIndex', 'db', 'rankInDatabase', 'target', 'rowTaxId', 'taxName',
        'requestedTaxId', 'requestedTaxName', 'requestedTaxRank', 'distanceToTaxon',
        'rankingField', 'rankingValue', 'seqId', 'coverage', 'description',
    ],
    rows,
});
