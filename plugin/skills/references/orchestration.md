# orchestration

**Read when:** `structural-analysis-workflow` sequences the full workflow.

## outcomes

Each stage is `attempted` with its result, `not attempted — prerequisites absent` with the missing input, or `failed` with its error.
Skipping an available stage is a defect; not running a stage whose input does not exist is a valid outcome.
Never fabricate a motif, member, or alignment to keep the chain moving.

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
| fewer than two structures | report and stop | widen explicit member criteria |
| redundant, divergent, gappy, or wrong-domain member set | disclose the measured limitation | rebuild the MSTA from a revised named hit selection |
| conservation signal too weak or too uniform to distinguish columns | report the observed pattern | revise the member set before changing column criteria |
| no candidate column | report no selection | revise stated criteria |
| intended reference lacks selected residues | report the limitation | change residue sets; choose another reference only if it remains an appropriate structure of interest |
| zero motif hits | report zero | widen databases or revise a sensitivity-limiting residue set |
| motif overfits the query or admits excessive noise | report the observed specificity or sensitivity problem | revise one declared residue-set hypothesis |
| saturated motif result | report descriptive lower bounds | none |
| expired artifact | re-export | none; this is not a revision |
| terminal job error | fail that stage with code and ticket | none |

## iteration-budget

Allow more than one evidence-backed revision when each iteration tests a declared biological or analytical hypothesis and compares its result with the prior run.
A revision may change several members or residues when they form one interpretable change, but do not sweep thresholds or combinations blindly.
Stop when the requested conclusion is supported, further revisions do not materially improve the answer, or the remaining choice requires user judgment.
Re-exporting, polling, rereading, correcting an identifier, or fixing malformed syntax is not a scientific revision.

## chain

Fold search → hit analysis → named hit selection → alignment → QC → site analysis → named column selection → motif search → motif analysis; reach is optional and clade breadth is a side branch.
Run the clade branch when the question asks about phyletic distribution or breadth and the export supplies usable taxonomy.
After a downstream result, follow its lineage to the relevant source selection, copy and revise that selection, and resume from the affected stage rather than rebuilding unrelated stages.
Carry result URLs, observations, selection criteria, limits, and each stage outcome into one report without upgrading claims downstream.
