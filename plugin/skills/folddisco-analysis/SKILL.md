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
5. Interpret the observations explicitly; neither a shortlist nor a distance threshold is an automatic recommendation.
6. Check whether the evidence answers the user's carrier, specificity, or scale question; a completed search may still leave that conclusion unresolved and may justify a reasoned change to the residue set, query entry, or database scope.

`T` is the exported pattern width, never the largest observed node count.
Report node count together with offset `T - nodecount`, and divide rates by that database's own row count.
Interpret IDF, RMSD, retention, match strata, and carrier coherence together ([motif metric interpretation](../references/interpretation.md#motif-metric-interpretation)).
Inspect a small bounded TSV in full or use header-based filters for a large table, and never cite a row id or motif residue without printing its row ([TSV query patterns](../references/interpretation.md#tsv-query-patterns)).
Key the distance tables to any other table on `dbIndex` rather than on the display `database` id, because per-database rates differ enough that a mismatched join would merge unlike populations ([common fields](../references/interpretation.md#common-fields)).

## Conditional branches

**Full-match pattern not shown in the summary**. The summary exposes only the five most frequent patterns, so absence there does not mean zero. Export to determine the full-match count; if none are present, report zero as a valid result.

**Saturated table.** Treat rates as descriptions of exported rows and carry the limitation into every broader claim ([saturation](../references/artifact-contract.md#saturation)).

**No rows in one database.** Report that database as a valid empty block beside the non-empty blocks.

**Possible under-specificity.** When full matches include geometrically or contextually incoherent carriers, compare the core motif with a reasoned extension using nearby, well-supported conserved positions; saturation or a modal full-match pattern alone does not establish this condition.

**Possible over-specificity.** When coherent near-matches repeatedly omit the same residue, compare a reasoned relaxed variant; a non-modal full-match pattern is a review signal rather than a diagnosis.

**Bounded motif sensitivity analysis.** Return to `foldmason-motif-forwarding` to compare a small declared set of variants when the initial motif does not answer the question clearly; keep the query entry and database scope fixed while isolating motif composition, and retain every result rather than selecting only the most favourable one ([iteration budget](../references/orchestration.md#iteration-budget)).

**Query entry limits interpretation.** If the chosen FoldMason entry has gaps, uncertain mapping, atypical geometry, or does not represent every entry relevant to the question, compare one or more other named entries through separate FoldDisco jobs; FoldDisco remains single-query, so do not pool them into one submission.

**Database scope limits interpretation.** If the completed job omitted relevant compatible databases or its database roster cannot support the requested carrier, annotation, or breadth claim, rerun with a reasoned expanded or revised roster.
Keep weakly annotated databases when their structural coverage matters, but restrict annotation or taxonomy claims to sources that provide that evidence; compare rates and carrier composition only over explicitly aligned database sets.

**Carrier scale requested.** FoldDisco target-residue labels do not provide chain length; use an independent length source for named carriers or report the population-scale question as unresolved ([motif metric interpretation](../references/interpretation.md#motif-metric-interpretation)).

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
Do not compare raw IDF, full-match counts, or rates as performance scores across different motif lengths.
Do not infer target-chain length from the highest matched residue number.

## Mutation and handoff

This skill makes no mutation.
Use `foldmason-motif-forwarding` to build or forward a motif and `fold-vs-motif-reach` to compare motif and fold carriers.

## Output shapes

Facts each outcome must establish and hand on; the answer states them in the reader's terms ([audience](../references/reporting.md#audience)).

- **Success** — the main exact or partial motif-match pattern in each database, relevant rates and RMSD, residues that may restrict sensitivity, notable candidates, limits, and result URLs.
- **Valid empty** — resolved databases with no motif hits, reported as a real result.
- **Degraded** — saturation, unresolved motif width, insufficient discrimination, or unavailable target lengths prevent part of the requested conclusion; state exactly what remains unresolved.
- **Error** — explain which required information is unavailable or inconsistent and what must be corrected before analysis.
