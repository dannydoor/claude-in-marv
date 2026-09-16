# orchestration

**Read when:** `structural-analysis-workflow` sequences the full workflow.

## outcomes

Each stage is `attempted` with its result, `not attempted — prerequisites absent` with the missing input, or `failed` with its error.
Skipping an available stage is a defect; not running a stage whose input does not exist is a valid outcome.
Never fabricate a motif, member, or alignment to keep the chain moving.
An attempted terminal stage may still leave the user's question unresolved; state whether the available evidence supports, partly supports, or cannot support the requested conclusion.

## stage-preconditions

| Stage | Required input |
|---|---|
| fold search | resolvable query |
| hit analysis | complete ticket with rows |
| member selection | explicit hit choice plus query, at least two structures total |
| alignment | at least two forwarded structures |
| alignment QC | entries and columns |
| site analysis | recorded QC observations |
| column selection | candidate occupied in the named reference entry |
| motif search | non-empty selected motif |
| motif analysis | complete motif ticket |

QC has no categorical pass threshold; carry measured limitations forward.

## branches

| Condition | Default | Possible evidence-backed revision |
|---|---|---|
| zero fold hits | report zero; later prerequisites absent | broaden databases, relax filter, or change mode |
| fold hits do not cover the relevant database, taxonomic population, query chain, or search behaviour | report the scope or setting that limits the answer | rerun the same query with a reasoned change to databases, mode, `taxFilter`, query index, or Foldseek `iterativeSearch` |
| fewer than two structures | report and stop | widen explicit member criteria |
| redundant, divergent, gappy, or wrong-domain member set | disclose the measured limitation | rebuild the MSTA from a revised named hit selection |
| conservation signal too weak or too uniform to distinguish columns | report the observed pattern | revise the member set before changing column criteria |
| no candidate column | report no selection | revise stated criteria |
| intended reference lacks selected residues | report the limitation | change residue sets; choose another reference only if it remains an appropriate structure of interest |
| zero motif hits | report zero | widen databases or revise a sensitivity-limiting residue set |
| motif may be too permissive because full matches include geometrically or contextually incoherent carriers | report the observed discrimination problem | compare a reasoned extension using nearby, well-supported conserved positions |
| motif may be too restrictive because coherent near-matches repeatedly omit the same residue | report the observed sensitivity problem | compare a reasoned relaxed variant |
| chosen motif query entry has gaps, uncertain mapping, atypical geometry, or incomplete relevance to the question | report which interpretation is entry-dependent | map the same columns to another named entry and run a separate motif search |
| motif database roster omits relevant compatible coverage or cannot support the requested interpretation | report the scope limitation | rerun with a reasoned expanded or revised database set |
| saturated motif result | report hit and distinct-structure counts as “at least”; describe rates and distributions only for the exported rows | none |
| expired artifact | re-export | none; this is not a revision |
| terminal job error | fail that stage with code and ticket | none |

## iteration-budget

Allow more than one evidence-backed revision when each iteration tests a declared biological or analytical hypothesis and compares its result with the prior run.
A revision may change several members or residues when they form one interpretable change, but do not sweep thresholds or combinations blindly.
For Foldseek, database roster, mode, `taxFilter`, query index, and the `iterativeSearch` option are separate axes; preserve each prior ticket and change one axis at a time where practical.
A changed mode can change ranking semantics, while a changed database or taxonomy filter changes the searched population, so re-read the new summary and do not compare raw ranks or scores as if the runs were identical.
More hits alone do not make a revised search better; judge whether it resolves the declared scope or candidate-selection limitation.
When the initial motif does not answer the question clearly, a bounded motif sensitivity analysis may compare a small declared set of core, relaxed, or extended variants.
Keep the query and database scope fixed where possible, report every attempted variant, and interpret changes in the returned population rather than choosing only the most favourable result.
Varying a conservation or distance threshold is allowed when the range and purpose are declared; exhaustive or post hoc optimisation is not.
Motif composition, query entry, and database scope are separate comparison axes; change one at a time where practical, but revise any axis that prevents the workflow from answering the question.
Stop when the requested conclusion is supported, further revisions do not materially improve the answer, or the remaining choice requires user judgment.
Re-exporting, polling, rereading, correcting an identifier, or fixing malformed syntax is not a scientific revision.

## chain

Fold search → hit analysis → named hit selection → alignment → QC → site analysis → named column selection → motif search → motif analysis; reach is optional and clade breadth is a side branch.
Run the clade branch when the question asks about phyletic distribution or breadth and the export supplies usable taxonomy.
After a downstream result, follow its lineage to the relevant source selection, copy and revise that selection, and resume from the affected stage rather than rebuilding unrelated stages.
Carry result URLs, observations, selection criteria, limits, and each stage outcome into one report without upgrading claims downstream.
