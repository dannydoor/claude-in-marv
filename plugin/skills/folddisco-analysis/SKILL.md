---
name: folddisco-analysis
description: Use when reviewing completed FoldDisco results for motif coverage, residue retention, RMSD, and candidates.
---

# folddisco-analysis

## Accepted starting state

Use a completed `folddisco` ticket; FoldDisco is single-query and refuses non-zero query indices ([query-index](../references/mcp-contract.md#query-index)).

## Summary facts to check

Read per-database row counts, top-level completeness, and pooled motif-pattern counts.
The summary gives a full-match count only when the all-ones pattern appears in its pooled top five; otherwise export before answering.

## Export condition and roles

Export for per-database, per-stratum, per-residue, row-level, or residue-geometry questions.
`folddisco/residue-distances` additionally requires `query-residue-coordinates` and `residue-geometry` ([roles-and-cardinality](../references/artifact-contract.md#roles-and-cardinality)).
On cloud Cowork, stage the exported descriptor files with `device_stage_files` ([cowork-staging](../references/artifact-contract.md#cowork-staging)).

## Default workflow

1. Answer whole-job distinct-pattern questions from the summary when sufficient.
2. Otherwise export, preflight, and run `folddisco/result-metrics` per database.
3. Add `folddisco/residue-retention` for residue-level retention, `folddisco/shortlist` for rows to inspect, or `folddisco/residue-distances` to locate geometrically inconsistent residue correspondences.
4. Query `shortlist.tsv`, `patterns.tsv`, and `residue-distances.tsv` with `awk` to filter by named metrics and to print each row or residue before discussing it; raise `--top` when the shortlist must cover more than the displayed rows ([table row coverage](../references/interpretation.md#table-row-coverage)).
5. Interpret the observations explicitly; neither a shortlist nor a distance threshold is an automatic recommendation, but good to review.

`T` is the exported pattern width, never the largest observed node count.
Report node count together with offset `T - nodecount`, and divide rates by that database's own row count.
Interpret IDF, RMSD, retention, match strata, and carrier coherence together ([motif metric interpretation](../references/interpretation.md#motif-metric-interpretation)).
Never read a table whole, and never cite a row id or motif residue without having printed its row ([TSV query patterns](../references/interpretation.md#tsv-query-patterns)).

## Conditional branches

**Full-match pattern not shown in the summary**. The summary exposes only the five most frequent patterns, so absence there does not mean zero. Export to determine the full-match count; if none are present, report zero as a valid result.

**Saturated table.** Treat rates as descriptions of exported rows and carry the limitation into every broader claim ([saturation](../references/artifact-contract.md#saturation)).

**No rows in one database.** Report that database as a valid empty block beside the non-empty blocks.

**The motif needs revision.** Return to `foldmason-motif-forwarding` when the motif appears over-specific, too permissive, or burdened by one or more low-retention or geometrically incoherent residues; compare a reasoned revision rather than sweeping combinations.

## Submission contract

None; this skill starts no job and mutates nothing.

## Subcommands

`folddisco/result-metrics`, `folddisco/residue-retention`, `folddisco/shortlist`, and `folddisco/residue-distances` use the shared [entry point](../references/analysis-cli.md#entry-point).
Their output columns are defined in [FoldDisco and reach tables](../references/interpretation.md#folddisco-and-reach-tables).

## Claim limits

Do not pool database-specific rates or IDF rankings.
Compare raw IDF only within one database and motif length, and distinguish motif-match rows from `distinctStructures`.
Report RMSD as a distribution, residue retention as an observed sensitivity constraint, and every stratum with its sample size; none is an automatic biological label ([motif metric interpretation](../references/interpretation.md#motif-metric-interpretation), [claim-limits](../references/reporting.md#claim-limits)).
Treat residue distances above 5 Å or 10 Å as review flags only; transformation or correspondence errors, flexibility, and alternate conformations can also produce large distances.

## Mutation and handoff

This skill makes no mutation.
Use `foldmason-motif-forwarding` to build or forward a motif and `fold-vs-motif-reach` to compare motif and fold carriers.

## Output shapes

Facts each outcome must establish and hand on; the answer states them in the reader's terms ([audience](../references/reporting.md#audience)).

- **Success** — the main exact or partial motif-match pattern in each database, relevant rates and RMSD, residues that may restrict sensitivity, notable candidates, limits, and result URLs.
- **Valid empty** — resolved databases with no motif hits, reported as a real result.
- **Degraded** — saturation or unresolved motif width, with unsupported figures omitted.
- **Error** — explain which required information is unavailable or inconsistent and what must be corrected before analysis.
