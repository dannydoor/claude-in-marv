---
name: foldmason-qc
description: Use when assessing alignment-wide and per-member quality in a completed FoldMason result.
---

# foldmason-qc

## Accepted starting state

Use a completed `foldmason` ticket with at least two entries and query index 0 ([query-index](../references/mcp-contract.md#query-index)).

## Summary facts to check

Read total columns, coordinate availability, top-level completeness, and parsed entry count; the export supplies the roster and residue counts ([summary-versus-manifest](../references/artifact-contract.md#summary-versus-manifest)).

## Export condition and roles

Export `msa-columns`, `msa-entries`, and `msa-fasta-aa`; the amino-acid alignment is required for pairwise identity and amino-acid consensus agreement.
Without it those observations are unavailable, not passed.
On cloud Cowork, stage the exported descriptor files with `device_stage_files` ([cowork-staging](../references/artifact-contract.md#cowork-staging)).

## Default workflow

1. Confirm at least two parsed entries, export, and preflight.
2. Run `msa/qc` for alignment-wide observations and `msa/member-audit` for member-level observations.
3. Run `msa/blocks` only when equal-support regions need locations.
4. Query `members.tsv` and `columns.tsv` with `awk` to locate gap-rich, low-agreement, or low-occupancy entries and to print any member named in a recommendation; never read a table whole ([TSV query patterns](../references/interpretation.md#tsv-query-patterns)).
5. Interpret the measurements together and state the evidence behind any recommendation ([MSA metric interpretation](../references/interpretation.md#msa-metric-interpretation)).

The outputs cover occupancy spread, conserved-column counts, pairwise identity, member gap fractions, consensus agreement, and blocks with the same observed carrier set.
These are measurements, not a universal quality grade.

## Conditional branches

**Uneven occupancy or member support.** Name the exact occupancy, gap, agreement, or identity observations without turning them into a biological conclusion.

**Redundant members.** Pairwise identity is computed from the realised amino-acid alignment; consider removing an overly close member when redundancy dominates and the remaining set still represents the intended query family.

**Rebuild.** Recommend only; never execute.
A rebuild returns to `foldseek-hit-analysis` when near-duplicates dominate, members are too divergent or gap-rich, an outlier or wrong domain entered the roster, or conservation is too weak or too uniform to distinguish useful columns.

## Submission contract

None; this skill starts no job and calls no mutating tool.

## Subcommands

`msa/qc`, `msa/member-audit`, and `msa/blocks` use `occupancy-v1` and the shared [entry point](../references/analysis-cli.md#entry-point).

## Claim limits

Occupancy, conservation, consensus agreement, and sequence identity are distinct observations with distinct denominators.
Member and column counts alone do not establish quality, and a whole-alignment score must be read with occupancy and member support.
Do not infer functional reliability from any one of them ([claim-limits](../references/reporting.md#claim-limits)).

## Mutation and handoff

Calls no mutating tool.
Send residue questions to `foldmason-conserved-site` and verified columns to `foldmason-motif-forwarding`.

## Output shapes

Facts each outcome must establish and hand on; the answer states them in the reader's terms ([audience](../references/reporting.md#audience)).

- **Success** — the main alignment-wide and member-level quality observations, their denominators, any evidence-backed recommendation, and the alignment result URL.
- **Valid empty** — none; an artifact with no usable alignment column is unreadable.
- **Degraded** — an expected role is absent; name each unavailable observation.
- **Error** — explain which alignment information could not be read and what must be corrected, then stop.
