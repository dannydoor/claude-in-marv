---
name: fold-vs-motif-reach
description: Use when comparing completed Foldseek and FoldDisco results for shared structural targets.
---

# fold-vs-motif-reach

## Accepted starting state

Use completed fold-side (`foldseek` or `multimer`) and motif-side (`folddisco`) artifacts.
Establish the same origin ticket and query index from recorded lineage before intersecting; a matching hash or database collection is insufficient ([lineage](../references/workflow-state.md#lineage)).
If recorded ancestry reaches one exact origin but cannot prove which FoldMason entry was the forwarded query, use `origin:session` only when you personally submitted both sides in this uninterrupted session.
Otherwise ask the user for a complete run-scoped assertion rather than inventing one.

## Summary facts to check

Read each database roster, per-database row count, and top-level completeness before deciding which pairs are comparable ([summary-versus-manifest](../references/artifact-contract.md#summary-versus-manifest)).

## Export condition and roles

Always export `rows` from both sides for databases with rows.
On cloud Cowork, stage both descriptor file sets with `device_stage_files` ([cowork-staging](../references/artifact-contract.md#cowork-staging)).
Only database pairs joined by the internal versioned collection map may be compared without an explicit collection assertion.

## Default workflow

1. Record both tickets, rosters, completeness states, and comparable database pairs.
2. Export and preflight both artifacts.
3. Run `workflow/reach` with the fold artifact as `--artifact-root` and motif artifact as `--against` ([accepted-flags](../references/analysis-cli.md#accepted-flags)).
4. If lineage crosses intermediate artifacts, provide each explicitly with `--via`; prefer recorded ancestry over `--assert`.
5. Verify resolved origin pairs, ancestry chain, exact, normalised, ambiguous, fold-only, motif-only, and shared carrier counts; do not treat exit 0 alone as verification.
6. Inspect a small bounded `intersection.tsv` in full or use header-based `awk` filters by `kind` or `matchLevel` for a large table, and print the carriers behind any count or example cited ([TSV query patterns](../references/interpretation.md#tsv-query-patterns)).

Identifier grammar, entry-level eligibility, assembly and chain qualifiers, and unparsed identifiers are defined only in [reach vocabulary](../references/interpretation.md#reach-vocabulary).

## Conditional branches

**No comparable database pair.** Report the rosters and why no intersection was attempted.

**Ambiguous identifiers.** Exclude ambiguous carriers and state which comparison counts they affect.

**Saturation.** Report observed shared carriers as “at least”; treat fold-only and motif-only counts as conditional on the exported sets because missing opposite-side rows may reclassify them as shared.

**Multimer or cross-chain comparison.** The monomer PDB entry key is withheld; keep structure-level carriers and report `summary.matchRule.withheld`.

**Session assertion.** `--assert origin:session` may replace only the missing proof that a named FoldMason entry was the forwarded query.
Provide every required `--via` artifact; the run must still reject missing or duplicate intermediates, malformed lineage, cycles, or different origin pairs ([reach assertions](../references/analysis-cli.md#reach-assertions)).

## Submission contract

None; this skill submits, forwards, and mutates nothing.

## Subcommands

`workflow/reach`, analysis version 1, uses the shared [entry point](../references/analysis-cli.md#entry-point).
Its output table is defined in [FoldDisco and reach tables](../references/interpretation.md#folddisco-and-reach-tables).

## Claim limits

Counts are normalised carriers, not rows.
An entry-level match claims only the PDB entry; claim assembly or chain agreement only when both sides name and share it.
State session or user assertions, snapshot skew, ambiguity, and saturation wherever they affect the result ([claim-limits](../references/reporting.md#claim-limits)).

## Mutation and handoff

This skill makes no mutation.
Use `folddisco-analysis` for motif detail and `foldseek-hit-analysis` for fold-side hit detail.

## Output shapes

Facts each outcome must establish and hand on; the answer states them in the reader's terms ([audience](../references/reporting.md#audience)).

- **Success** — the databases compared, structures found by both searches, exact and normalised match counts, relevant assembly or chain limitations, shared starting query, and result URLs.
- **Valid empty** — comparable searches with no structure found by both.
- **Degraded** — saturation or ambiguity restricts the comparison; distinguish shared lower bounds from side-only counts conditional on the exported sets.
- **Error** — explain why the searches cannot be compared and what input or confirmation is needed; write no result bundle.
