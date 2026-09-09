---
name: foldmason-motif-forwarding
description: Use when saving chosen FoldMason columns as a verified motif and forwarding it to FoldDisco.
---

# foldmason-motif-forwarding

## Accepted starting state

Use a completed `foldmason` ticket, candidate columns from `foldmason-conserved-site`, and a reference entry chosen by name.
Carry `foldmason-qc` limitations when available.

## Summary facts to check

Read `totalColumns` and existing `selections[]`.
The summary has no entry roster, so the default path confirms the reference from the `entryName` returned by `select_msa_columns`; an exported `msa-entries` roster is another valid check ([entry-order](../references/workflow-state.md#entry-order)).

## Export condition and roles

The default selection-and-forwarding path needs no export.
Export only for substitution proposals or author numbering, using the roles defined in [roles-and-cardinality](../references/artifact-contract.md#roles-and-cardinality).
On cloud Cowork, stage those exported descriptor files with `device_stage_files` ([cowork-staging](../references/artifact-contract.md#cowork-staging)).

## Default workflow

1. Confirm that `entryName` is the intended FoldDisco query structure, use `column` as the 0-based machine value, never forward display-only `oneBased`, and choose a new destination-based selection name ([column-selection-validator](../references/workflow-state.md#column-selection-validator), [selection-naming](../references/workflow-state.md#selection-naming)).
2. Call `select_msa_columns` with `action: "set"`; validate the complete returned selection state and confirm `entryName`.
3. Show the returned motif, residue mapping, gaps, and dropped substitutions; require confirmation when case-sensitive substitutions or gaps matter ([substitution-case](../references/workflow-state.md#substitution-case)).
4. Call `list_databases({tool: "folddisco"})`, start from the complete compatible set, exclude only databases that do not serve the question, and pass the remaining ids to `send_to`.
5. Record the destination ticket and frozen `derivedFrom` roster, then hand it to `folddisco-analysis` ([lineage](../references/workflow-state.md#lineage)).

## Conditional branches

**Substitution requested.** Run `msa/substitution-proposal`, print candidate columns you want to look from `substitutions.tsv` with `awk` ([TSV query patterns](../references/interpretation.md#tsv-query-patterns)), make the choice explicitly, obtain confirmation, apply it through `select_msa_columns`, and re-check `droppedSubstitutions`.

**Author numbering requested.** Run `msa/author-numbering` against a caller-supplied structure and query `numbering.tsv` for rows where `agrees` is not `true`; a sequence mismatch is an error, not a weak result.

**All selected positions are gaps.** Report the empty motif and forward nothing.

**A completed FoldDisco result motivates revision.** Follow its lineage back to the source column selection, copy it under a new name, change one declared residue-set hypothesis with `add`, `remove`, or `set`, and forward the revised selection ([revision-from-lineage](../references/workflow-state.md#revision-from-lineage)).

## Submission contract

Use one new `to-<destination>__NNN` name per forwarding job.
Edit a copy rather than a forwarded selection, because downstream lineage records its frozen state ([selection-naming](../references/workflow-state.md#selection-naming)).

## Subcommands

`msa/substitution-proposal` and `msa/author-numbering` are optional `motif-build-v1` analyses run through the shared [entry point](../references/analysis-cli.md#entry-point).
Both take `--entry` and `--columns`; author numbering also takes `--structure` ([accepted-flags](../references/analysis-cli.md#accepted-flags)).

## Claim limits

The forwarded motif is exactly what `select_msa_columns` returns; the analysis never selects a substitution automatically.
Keep author numbering distinct from alignment labels, and never apply modelled-chain labels to a separately fetched deposit ([MSA metric interpretation](../references/interpretation.md#msa-metric-interpretation), [claim-limits](../references/reporting.md#claim-limits)).

## Mutation and handoff

This skill calls `select_msa_columns`, `list_databases`, and `send_to`.
Hit selection belongs to `server-operations`; candidate discovery belongs to `foldmason-conserved-site`.

## Output shapes

Facts each outcome must establish and hand on; the answer states them in the reader's terms ([audience](../references/reporting.md#audience)).

- **Success** — reference to forward, selected columns, resulting motif, gaps or substitutions, destination result URL, and the earlier alignment and selection it continued from.
- **Valid empty** — an all-gap selection with no forwarded motif.
- **Degraded** — optional numbering or substitution evidence is unavailable; state what could not be checked.
- **Error** — explain which entry, residue, substitution, sequence, or database choice must be corrected; stop before forwarding.
