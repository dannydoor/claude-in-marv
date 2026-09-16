---
name: structural-analysis-workflow
description: Use when coordinating the plugin's analysis skills into an end-to-end structural bioinformatics workflow.
---

# structural-analysis-workflow

## Accepted starting state

Start from a goal plus an accession, query file, or existing ticket.
If the request is a single action, route it to that action's skill instead of orchestrating a chain.

## Summary facts to check

This skill owns no scientific measurement; it carries each stage's ticket, query index, observations, and claim limits.

## Export condition and roles

Each stage skill owns its own export and role requirements ([roles-and-cardinality](../references/artifact-contract.md#roles-and-cardinality)).
On cloud Cowork, every exporting stage uses `device_stage_files` ([cowork-staging](../references/artifact-contract.md#cowork-staging)).

## Default workflow

1. Name the target terminal stage and planned route.
2. Run each stage through its owner: `server-operations`, `foldseek-hit-analysis`, `foldmason-qc`, `foldmason-conserved-site`, `foldmason-motif-forwarding`, then `folddisco-analysis`; add `foldseek-phyletic-profile` when the question asks about phyletic distribution or clade breadth and taxonomy is available.
3. Before continuing, check the next stage's precondition and take the defined stop or evidence-backed revision when needed ([stage-preconditions](../references/orchestration.md#stage-preconditions), [branches](../references/orchestration.md#branches)).
4. Classify the terminal stage as attempted, not attempted because prerequisites were absent, or failed, then state whether its evidence supports, partly supports, or cannot support the user's requested conclusion ([outcomes](../references/orchestration.md#outcomes)).
5. Write a concise answer and a separate compact Markdown report for the complete chain in the reader's terms ([audience](../references/reporting.md#audience), [report-shape](../references/reporting.md#report-shape)).

Carry upstream limitations forward; no downstream stage may widen a claim.

## Conditional branches

**Evidence-backed revision.** Revisit the Foldseek database roster, mode, taxonomy filter, query chain or iterative-search setting, or the downstream member set, residue set, motif query entry or database scope when the measurements justify it.
Preserve the source result or selection and record every attempted variant, what changed, why, and what the comparison showed ([iteration budget](../references/orchestration.md#iteration-budget)).

**Prerequisite absent.** Stop and report the completed stages plus the missing input as the result.

**Terminal error.** Explain which stage failed and the required action; include its ticket and code only when they help troubleshooting, and do not resubmit automatically.

## Submission contract

None of its own.
`server-operations` submits and manages hit selections; `foldmason-motif-forwarding` manages column selections and FoldDisco forwarding.

## Subcommands

None; each stage runs its own analysis and returns only measured facts.

## Claim limits

Carry the narrowest upstream limit, the reason for any revision, and the terminal outcome.
Keep each stage's own interpretation within the shared [claim limits](../references/reporting.md#claim-limits).

## Mutation and handoff

This skill calls no tool directly.
`foldseek-phyletic-profile` is an optional clade branch and `fold-vs-motif-reach` an optional final comparison; direct search or QC requests route to `server-operations` or `foldmason-qc`.

## Output shapes

Facts each outcome must establish and hand on; the answer states them in the reader's terms ([audience](../references/reporting.md#audience)).

- **Success** — concise conclusion, the route described by what each step did, key insights, explicit selection criteria, material limits, browser result URLs, and how revisions continued from earlier choices.
- **Valid empty** — a negative stage result with later stages marked not attempted because prerequisites were absent.
- **Degraded** — a material evidence limitation carried into the final conclusion.
- **Error** — the failed step, plain-language reason, completed path, stopping point, and required user action; include technical identifiers only when they help troubleshooting.
