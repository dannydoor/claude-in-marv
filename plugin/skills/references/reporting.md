# reporting

**Read when:** writing any answer or report for the user.

## audience

Write for a reader who understands the measurements but knows nothing about this plugin.
The reader recognises identity, coverage, RMSD, occupancy, conservation score and the other reported values.
The reader does not know which skill, subcommand, script, or table produced a number, and must never need to.
Summarise the insight from each analysis at a high level, using only the few values that support the conclusion or a material choice.
Do not enumerate intermediate outputs, raw rows, or every available metric.
Translate implementation facts into their biological or operational meaning: what was searched, what overlapped, what was chosen, and what limits the comparison.
Identify material choices by database, chosen hit ids, reference entry, or columns; prefer browser result URLs and include a ticket or query index only when it helps reopen a result.
Do not name a skill, subcommand, analysis version, artifact role, table file, warning code, or internal field as the source or subject of a sentence.
Refer to a step by what it did: the structure search, the alignment, the conservation ranking, the motif search.
Write "among 240 hits in PDB100, rows 3, 17 and 41 were chosen for the alignment because they cover over 80% of the query at 30–45% identity", not "hit/member-selection listed candidates.tsv; selected id 3, 17, 41".
A skill's `Output shapes` list what a stage must establish and hand on, not the vocabulary of the answer.

## report-shape

Give the user a concise answer with the conclusion, decisive evidence, material limitation, and next action.
For a complete multi-stage workflow, always write a separate compact Markdown report and link it from the concise answer.
For a single-stage task, write a separate report only when an auditable record is useful or the user requests one.
The report preserves enough information to revisit the server results and reconstruct the decisions without dumping every intermediate value.

The detailed report should contain:

- the question and conclusion;
- a browser result URL for each material job, with ticket or query index only when it helps provenance;
- the selected database names, adding versions only when a mismatch affects interpretation;
- explicit inclusion and exclusion criteria plus the chosen hit ids, entry, or columns;
- the key insight from each material analysis, with only the metric values that influenced a choice;
- a brief FoldDisco evaluation covering exact or partial motif matches, RMSD, IDF, consistently retained residues, distance outliers when measured, and distinct structures;
- for each revision, the source selection or result URL, what changed, why it changed, the new result URL, and the observed consequence;
- material limitations and any unresolved choice.

Do not report an artifact root as durable provenance because exported artifacts can be collected by GC.
Only when it helps inspection, put a retained table path in a short technical-details section rather than using its filename to explain a finding.
Omit logs, exhaustive metric dumps, and method prose unless requested.

## claim-limits

- Report measurements as measurements and mechanisms as hypotheses.
- Saturated or capped counts are lower bounds, never exhaustive rates.
- Rank or merge only where the metric and mode declare comparability.
- Missing inputs do not support absence claims; explain which measurements could not be made.
- Put every material limitation in the conclusion and apply its consequence there or in the limits.

## units-and-definitions

Always include units: `seqId` is 0–100 percent, while `coverage` is a 0–1 fraction.
Name the ranking field carried by `value` or `rankingValue`, not those container column names.
Descriptions are server annotations for candidate review, not established functions.

## warning-codes

Translate analysis warnings into their consequence and required action rather than using the code as the explanation.
For a terminal server error, explain the failure in plain language and include its code in parentheses only when it helps troubleshooting.
Levels: **blocking** forbids the claim, **caution** restricts it, and **note** reports without restriction.
Warnings aggregate by code and scope with a count, bounded sample, and table path.

| code | default level | claim action |
|---|---|---|
| `DATABASE_ERROR` | blocking | exclude and name that database |
| `SATURATED_ROWS` | caution | use lower bounds; no exhaustive rate |
| `ZERO_HIT_DATABASE` | note | report zero as a result |
| `NO_TAXONOMY_TREE` | caution | exclude from clade arithmetic |
| `LOW_TAXONOMY_COVERAGE` | caution | restrict clade claims to included databases |
| `MISSING_DESCRIPTIONS` | note | description coverage is not function coverage |
| `CROSS_DATABASE_INCOMPARABLE` | caution | rank within databases only |
| `MISSING_COLUMN_METRIC` | note | exclude unscored columns and report their count |
| `SINGLE_MEMBER_SUPPORT` | note | one carrier is not a family feature |
| `REFERENCE_RESIDUE_ABSENT` | blocking | the motif is not the intended site |
| `PATTERN_WIDTH_MISMATCH` | blocking | make no per-residue match claim |
| `COORDINATE_COUNT_MISMATCH` | blocking | make no geometric claim |
| `QUERY_RESIDUES_UNAVAILABLE` | caution | do not use full-match rate |
| `DATABASE_SET_UNKNOWN` | caution | database choice remains untested |
| `NO_COMMON_DATABASE` | blocking | fold and motif reach are incomparable |
| `INTEGRITY_ISSUE` | caution | limit claims to unaffected rows and state what was excluded |

Server integrity codes retain their names internally.
