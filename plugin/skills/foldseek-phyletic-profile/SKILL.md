---
name: foldseek-phyletic-profile
description: Use when summarizing clade breadth and per-clade sequence identity from completed Foldseek hits.
---

# foldseek-phyletic-profile

## Accepted starting state

Use a completed `foldseek` or `multimer` ticket and the intended `queryIdx` ([query-index](../references/mcp-contract.md#query-index)).
A missing taxonomy report degrades the answer rather than refusing the skill.

## Summary facts to check

Read per-database `taxonomyTree` and `parsedRows`, top-level `completeness`, and the row share covered by tree-carrying databases.

## Export condition and roles

Always export `rows`; use `taxonomy` only for databases that declare and provide a tree ([taxonomy-availability](../references/artifact-contract.md#taxonomy-availability), [roles-and-cardinality](../references/artifact-contract.md#roles-and-cardinality)).
On cloud Cowork, stage the exported descriptor files with `device_stage_files` ([cowork-staging](../references/artifact-contract.md#cowork-staging)).

## Default workflow

1. Name included and excluded databases before computing clade statistics.
2. Export, preflight, and run `hit/phyletic` once; add `--taxon <NCBI-tax-id>` when individual hits from one taxon and its descendants are requested.
3. Report clade counts, fractions, evenness, and identity ranges only over contributing databases, with their row coverage.
4. Inspect a small bounded TSV in full or query a large `clades.tsv` or `taxon-hits.tsv` with header-based `awk`, for example `distanceToTaxon==0` for exact assignments, and print any hit cited in the answer ([TSV query patterns](../references/interpretation.md#tsv-query-patterns)).
5. For `--taxon`, require `assessmentComplete` before treating an empty table as zero matches over the selected result.

## Conditional branches

**No usable tree.** Report row-level organism labels as a descriptive tally and state that no tree traversal was possible.

**Rows do not resolve into the supplied tree.** Report both the tree-covered row share and the successfully attributed share.

**A taxon is requested.** Use its numeric NCBI id, not a name; membership follows exported `parentTaxId` ancestry, and `distanceToTaxon` distinguishes exact assignments from descendants.

**A taxonomy file is damaged.** Stop as an artifact error; an absent or empty taxonomy role is not the same condition.

## Submission contract

None; taxon-restricted searches belong to `server-operations`.

## Subcommands

`hit/phyletic`, analysis version 1, run through the shared [entry point](../references/analysis-cli.md#entry-point).
It writes `tables/clades.tsv`, adds `tables/taxon-hits.tsv` when `--taxon` is supplied, and writes `tables/warnings.tsv` when needed.

## Claim limits

Restrict every clade figure to databases that supplied a usable tree and state their row coverage.
Treat evenness, largest shares, and identity ranges as observations of exported hits, not biological dominance or transfer findings ([claim-limits](../references/reporting.md#claim-limits)).
A dominant taxon may reflect redundant sampling rather than biological breadth.
Treat `taxName` as display text only, never as proof of ancestry or as a substitute for a missing tree.
Ranking and member-pool questions belong to `foldseek-hit-analysis`.

## Mutation and handoff

This skill makes no mutation.
Use `server-operations` for a new filtered search and `foldseek-hit-analysis` for ranking or selection.

## Output shapes

Facts each outcome must establish and hand on; the answer states them in the reader's terms ([audience](../references/reporting.md#audience)).

- **Success** — clade breadth, distribution across clades, identity ranges, the share of hits that could be assigned, material limits, requested-taxon hits, and the search result URL.
- **Valid empty** — a usable tree with no attributed rows; report it as a real result.
- **Degraded** — partial tree coverage or label-only analysis, with excluded databases named.
- **Error** — explain which result or input is invalid and what must be corrected; absent taxonomy alone is not an error.
