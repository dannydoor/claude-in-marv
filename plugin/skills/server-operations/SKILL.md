---
name: server-operations
description: Use for submitting Foldseek-family jobs, checking results, saving selections, exporting data, or forwarding inputs.
---

# server-operations

## Accepted starting state

Start without a ticket to list databases or submit a job, with any ticket to check status, and with a completed `foldseek` or `multimer` ticket to select or forward hits.
Use `queryIdx`, default 0; for a multi-chain query, select the chain through the completed result's `queries.items[]` mapping and preserve that index throughout the workflow ([query-index](../references/mcp-contract.md#query-index)).

## Summary facts to check

Check status, browser result URL, per-database `parsedRows`, top-level `completeness`, input echoes, query length and header, and `integrityIssues` ([input-origins](../references/mcp-contract.md#input-origins)).

## Export condition and roles

This skill exports only when a downstream skill needs row, column, taxonomy, or coordinate files.
Call `get_shared_dir` before export, if haven't; after export, a same-filesystem session checks the exact directory while cloud Cowork stages the descriptor files with `device_stage_files` ([preflight](../references/artifact-contract.md#preflight), [cowork-staging](../references/artifact-contract.md#cowork-staging)).
Hand the descriptor and required roles to the downstream skill rather than reading data files here ([roles-and-cardinality](../references/artifact-contract.md#roles-and-cardinality)).

## Default workflow

1. Call `list_databases({tool})`, begin with the complete compatible set, and exclude only databases that do not serve the question; use returned ids rather than remembered paths ([databases](../references/mcp-contract.md#databases)).
2. Submit once with `validateOnly: true`, correct any reported problem, then submit for real ([response-channels](../references/mcp-contract.md#response-channels)).
3. Record the input echo, ticket, query index, resolved chain when available, and resolved accession or file roster.
4. Poll `get_ticket_status` to a terminal state; continue only on `COMPLETE` ([polling](../references/mcp-contract.md#polling)).
5. Read `get_result_summary`; export only when the requested answer needs data not present there.

## Conditional branches

**Refused query index.** Report the valid range from the server and stop; a refusal is not an empty result ([zero-hit](../references/mcp-contract.md#zero-hit)).

**Multi-chain query.** Choose the structure chain of interest from `queries.items[]` and keep its `queryIdx`; if the mapping is absent or has no chain labels, ask for an explicit index rather than guessing from order ([query-index](../references/mcp-contract.md#query-index)).

**Selection and forwarding.** List existing names, describe the source selection when its prior size matters, mutate, validate the response, and then call `send_to` ([selection-naming](../references/workflow-state.md#selection-naming), [hit-selection-validator](../references/workflow-state.md#hit-selection-validator), [lineage](../references/workflow-state.md#lineage)).

**Revision after a downstream result.** Follow its recorded lineage to the source ticket and selection, copy that selection under a new name, make the reasoned changes, and submit the revised selection ([revision-from-lineage](../references/workflow-state.md#revision-from-lineage)).

**Validation refusal.** Correct `{ok: false, problems[]}` before submitting; surface taxonomy candidates verbatim and ask for a numeric id when needed.

**Accession-derived motif.** Treat a Q-BioLiP structure-contact-derived binding-site annotation returned through `autoMotif` as a motif candidate, inspect its residues, and require explicit acceptance before the real submission ([input-origins](../references/mcp-contract.md#input-origins)).

**Direct motif.** Use `folddisco_search` directly only for an externally supplied motif or one with no alignment provenance.
An MSA-derived motif must go through `foldmason-motif-forwarding`, which verifies and forwards the saved column selection.

**Custom structure.** Put it under the shared `imports/` directory and pass its import-relative path; do not invent a device or cloud path ([input-origins](../references/mcp-contract.md#input-origins)).

**FoldMason accession input.** Direct accession loading can expand chains into separate alignment entries, whereas selected hits forwarded through `send_to` can carry an explicitly encoded multichain entry; inspect the completed `msa-entries` roster rather than predicting entry count from accession count ([foldmason-entry-shape](../references/mcp-contract.md#foldmason-entry-shape)).

## Submission contract

| Intent | Tool | Required | Important refusal |
|---|---|---|---|
| structure search | `foldseek_search` | `databases` and exactly one advertised query origin | multiple origins or a literal database path |
| complex search | `multimer_search` | same | same; chain values are not top-level values |
| alignment | `foldmason_msa` | at least two structures total across `files`, `fileRefs`, and `accessions` | fewer than two inputs |
| motif search | `folddisco_search` | `databases`, one query origin, and an explicit `motif` unless `{autoMotif: true}` supplies one | `taxFilter`, `mode`, or a missing motif |
| hit selection | `select_hits` | `ticketId`, action, and the fields required by that action | reusing a frozen forwarding name |
| forwarding | `send_to` | source selection and destination; FoldDisco also requires `databases` | omitted or unusable FoldDisco databases |

## Subcommands

None; this skill runs no local analysis.

## Claim limits

Report returned facts, not biological interpretations.
Row counts and database sizes are not signal strength, enrichment, quality, or importance; hand ranking and coverage questions to `foldseek-hit-analysis` and clade questions to `foldseek-phyletic-profile` ([report-shape](../references/reporting.md#report-shape)).

## Mutation and handoff

This skill may submit jobs, call `select_hits`, and call `send_to`.
It never calls `select_msa_columns`; column selection and FoldDisco forwarding belong to `foldmason-motif-forwarding`.
Hand completed search tickets to `foldseek-hit-analysis` or `foldseek-phyletic-profile`, and completed alignments to `foldmason-qc`.

## Output shapes

Facts each outcome must establish and hand on; the answer states them in the reader's terms ([audience](../references/reporting.md#audience)).

- **Success** — what was submitted or ticket state, browser result URL when available, databases used, confirmed input, and any validated selection or earlier result it continued from.
- **Valid empty** — a resolved zero-hit search, with query length and the databases that returned no rows.
- **Degraded** — summary-only facts when integrity or shared-directory access prevents export; state the limitation and required user action.
- **Error** — explain the failure and required action in plain language; include the ticket and technical code only when they help troubleshooting, then stop without further submission.
