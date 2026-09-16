---
name: foldseek-hit-analysis
description: Use when reviewing completed Foldseek or Multimer hits and choosing candidates for a FoldMason alignment.
---

# foldseek-hit-analysis

## Accepted starting state

Use a completed `foldseek` or `multimer` ticket.
Resolve the intended `queryIdx` from the result's query roster before interpreting any hits ([query-index](../references/mcp-contract.md#query-index)).

## Summary facts to check

Read `queries.count` and `queries.items[]` first, then read the submitted databases and search settings, per-database row counts, taxonomy availability, top hits, the full `ranking` object, query length and header, and top-level `completeness` for the intended query.

## Export condition and roles

Summary-only count and cap questions need no export; individual-hit questions require each available `rows` role ([roles-and-cardinality](../references/artifact-contract.md#roles-and-cardinality)).
On cloud Cowork, stage the exported descriptor files with `device_stage_files` ([cowork-staging](../references/artifact-contract.md#cowork-staging)).

## Default workflow

1. Read the query roster before inspecting hits: use `queryIdx: 0` only to obtain `queries.count` and `queries.items[]`, not as an assumption about the user's intended chain.
2. If there is one query, continue with its index; if there are several, choose the uniquely relevant chain from `queries.items[]` and the user's question, or ask for the intended `queryIdx` when the mapping is absent, null, or ambiguous.
3. If the request covers several query chains, inspect each `queryIdx` separately and do not pool their hits or statistics.
4. Re-read the summary for each selected `queryIdx`, preserve that index through export and analysis, and answer count, location, and cap questions from that summary when possible.
5. Otherwise export, preflight, and choose one analysis: `hit/survey` for database distribution, `hit/table` for leading hits, `hit/coverage` for query-residue coverage, or `hit/member-selection` for alignment candidates.
6. Report per database; merge only a ranking field the server marks cross-database comparable ([row-order](../references/mcp-contract.md#row-order)).
7. Inspect a small bounded TSV in full or use header-based `awk` filters for a large hit table, and print each hit under consideration before citing it ([TSV query patterns](../references/interpretation.md#tsv-query-patterns)).
8. For a member pool, state the criteria, make an explicit choice from the printed candidates, and hand the chosen row ids to `server-operations`.

## Conditional branches

**Several analyses are genuinely needed.** Run each separately, then combine their high-level insights without listing every available metric.

**Query roster unavailable.** Do not guess chain order or interpret the default query as representative; ask the user for the intended `queryIdx` ([query-index](../references/mcp-contract.md#query-index)).

**A member pool is requested.** The script applies no identity band, coverage floor, taxonomic quota or automatic balance rule.
Use Foldseek hit `seqId`, coverage, query and target lengths, aligned spans, rank, organism, domain context, and description to choose a balanced set explicitly ([hit-set interpretation](../references/interpretation.md#hit-set-interpretation)).
Avoid a pool made only of near-identical hits, which can make conservation uninformatively uniform, and avoid a pool so divergent that alignment and conserved signal become unreliable.
Prefer a useful spread around moderately similar hits rather than imposing one universal identity cutoff.
State the criteria and the chosen row ids; descriptions are source annotations for candidate review, not established functions.

**A complex is analysed.** Keep per-chain coverage distinct from any labelled aggregate.

**Phyletic distribution matters.** When the question asks about clade breadth or lineage distribution and taxonomy is available, also run `foldseek-phyletic-profile`.

**The search does not cover the question well enough.** Keep the current result as evidence and identify the limitation before requesting a new search.
A revised Foldseek search may change the compatible database set, search mode, `iterativeSearch`, or `taxFilter`; a revised Multimer search may change the database set, mode, or `taxFilter`, but does not support `iterativeSearch`.
Treat these as separate comparison axes, change one at a time where practical, and hand the exact revised query and settings to `server-operations` ([search-settings](../references/mcp-contract.md#search-settings), [iteration budget](../references/orchestration.md#iteration-budget)).

## Submission contract

None; this skill reads an existing artifact and does not mutate server state.
A justified re-search is handed to `server-operations` rather than submitted here.

## Subcommands

`hit/survey`, `hit/table`, `hit/coverage`, and `hit/member-selection`, all analysis version 1.
Run them through the shared [entry point](../references/analysis-cli.md#entry-point); `hit/table` previews descriptions and may keep the requested top rows without inferring function.

## Claim limits

Report per database first, retain the server's ranking semantics, and label any alternative sort.
Capped rows support statements about the export, not the full database; identity is a percentage and coverage is a fraction ([units-and-definitions](../references/reporting.md#units-and-definitions)).
Phyletic interpretation belongs to `foldseek-phyletic-profile` ([claim-limits](../references/reporting.md#claim-limits)).

## Mutation and handoff

This skill makes no mutation.
`server-operations` submits revised searches, saves and forwards chosen hits; `foldseek-phyletic-profile` owns tree-based clade analysis.

## Output shapes

Facts each outcome must establish and hand on; the answer states them in the reader's terms ([audience](../references/reporting.md#audience)).

- **Success** — the inspected query chain when available, requested hit observations, criteria and ids for any explicit choice, material limits, and the search result URL.
- **Valid empty** — a resolved zero-hit result with query length and the databases searched ([zero-hit](../references/mcp-contract.md#zero-hit)).
- **Degraded** — a capped table or unusable ranking field, with its consequence stated.
- **Error** — explain which search result or input could not be read and what must be corrected; stop without further computation.
