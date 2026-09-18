---
name: foldmason-conserved-site
description: Use when ranking FoldMason columns by conservation and mapping chosen residues to structure geometry.
---

# foldmason-conserved-site

## Accepted starting state

Use a completed `foldmason` ticket and choose by name the structure of interest to use for the FoldDisco query; mapping and occupancy confirm whether that choice is usable ([selectors](../references/analysis-cli.md#selectors)).
Carry existing `foldmason-qc` observations; if QC was not run, proceed when requested and state that limitation.

## Summary facts to check

Read total columns, coordinate availability, and parsed entry count; obtain the entry roster from the export ([summary-versus-manifest](../references/artifact-contract.md#summary-versus-manifest)).

## Export condition and roles

Ranking requires `msa-columns` and `msa-entries`; geometry additionally requires `msa-coordinates` and `msa-residue-map` ([roles-and-cardinality](../references/artifact-contract.md#roles-and-cardinality)).
On cloud Cowork, stage the exported descriptor files with `device_stage_files` ([cowork-staging](../references/artifact-contract.md#cowork-staging)).

## Default workflow

1. Run `msa/column-ranking` to order columns by conservation score, with column index as the deterministic tie-break.
2. Run `msa/column-composition` for shortlisted columns and inspect the reference residue, consensus, residue frequencies, property vector, occupancy, and conservation state before choosing.
3. Use `msa/column-residues` when gaps or member-specific residue mappings could change the interpretation.
4. Run `msa/compactness` for chosen columns only when coordinates and a residue map exist, and use it as supporting geometry rather than a selection gate ([compactness interpretation](../references/interpretation.md#compactness-interpretation)).
5. Query the generated TSVs with `awk` before naming a candidate; filter the complete `columns.tsv` when a capped ranking table may omit rows ([table row coverage](../references/interpretation.md#table-row-coverage), [TSV query patterns](../references/interpretation.md#tsv-query-patterns)).
6. Join results by `column`, keeping it as the 0-based machine value and using `oneBased` for display only; `pairwise.tsv` names each residue by its exported label and carries `aColumn`/`bColumn` for that join.

Property vectors, modal fraction, occupancy and geometry inform interpretation; they do not alter the score order or establish a functional site.
Conservation may reflect structural maintenance, biological function, or both, and these measurements do not separate those causes automatically.
Inspect a small bounded TSV in full or use header-based filters for a large column table, and never name a candidate without printing its row.

## Conditional branches

**No coordinates.** Step 4 does not run; geometry fields are `n/a`, the report names the absent role as the reason, no substitute figure is offered, and the candidate set still ships.

**Gap in the reference.** Keep the conservation observation but exclude that column from the chosen reference's geometry and motif; choose another reference only when it is still an appropriate structure of interest for the query.

**Low occupancy.** Keep and report the observed occupancy without applying a hidden floor.

**Member set limits the signal.** If QC finds length outliers, near-duplicates, gap-rich members, or a conservation ranking that is too weak or too flat to distinguish columns, revisit the member set before changing the column criteria.

## Submission contract

None; this skill creates no selection and forwards nothing.

## Subcommands

`msa/column-ranking`, `msa/column-composition`, `msa/column-residues`, and `msa/compactness` are run through the shared [entry point](../references/analysis-cli.md#entry-point).

## Claim limits

Conservation score orders candidates; the property vector explains the conserved chemistry, and geometry describes their arrangement; together they may support a functional-site inference but do not establish one ([MSA metric interpretation](../references/interpretation.md#msa-metric-interpretation)).
Equal scores may encode different positive and negative constraints, and 3Di symbols are not amino-acid properties.
Name any prior belief used to add a column by hand, and apply the shared [claim limits](../references/reporting.md#claim-limits).

## Mutation and handoff

This skill makes no mutation.
Send chosen columns to `foldmason-motif-forwarding`; send alignment-quality questions to `foldmason-qc`.

## Output shapes

Facts each outcome must establish and hand on; the answer states them in the reader's terms ([audience](../references/reporting.md#audience)).

- **Success** — ranked residue candidates, why they were considered, available spatial context, material limitations, and the alignment result URL.
- **Valid empty** — none; no usable column is an unreadable artifact.
- **Degraded** — geometry or upstream QC is unavailable, or a candidate has low occupancy; state the consequence.
- **Error** — explain which alignment information is unavailable or inconsistent and what must be corrected, then stop.
