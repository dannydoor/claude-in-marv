# interpretation

**Read when:** interpreting analysis metrics or inspecting and filtering generated TSV tables.

## tsv-query-patterns

Every table has a header, uses tabs, writes booleans as `true` or `false`, and leaves unavailable values empty.
A small bounded TSV may be inspected in full when that is the clearest check.
For large hit or column tables, use `awk` instead of dumping the table into the conversation.
Before naming a row or column in a selection, inspect it and verify the fields used for that decision.
Use the header name instead of a fixed field number so the command remains correct if columns move.
These thresholds are query examples, not scientific defaults; replace them and state the criterion used.

Header-only output means no row matched. Before concluding that a row is absent, check [table row coverage](#table-row-coverage): a capped table omits rows that exist in the result.

Build `c` from the header, print the header, and put the desired condition after `next`:

```sh
awk -F '\t' 'NR==1 {for(i=1;i<=NF;i++) c[$i]=i; print; next} CONDITION' <table.tsv>
```

Common conditions are:

| Purpose | Condition fragment |
|---|---|
| exact string or boolean | `$(c["field"]) == "value"` |
| numeric threshold | `$(c["field"]) != "" && $(c["field"]) >= 0.8` |
| text pattern | `tolower($(c["field"])) ~ /kinase/` |
| missing value | `$(c["field"]) == ""` |
| combine conditions | `condition1 && condition2`, or `condition1 || condition2` |

Inspect an arbitrary hit by stable row id (`dbIndex#rowIndex`, for example `0#12`, never a target name):

```sh
awk -F '\t' -v want='0#12' 'NR==1 {for(i=1;i<=NF;i++) c[$i]=i; if(!("id" in c)) exit 2; print; next} $(c["id"])==want' <out>/tables/hits.tsv
```

Inspect an MSA column by its 0-based index; use the condition fragments above to filter by measured properties:

```sh
awk -F '\t' -v col='127' 'NR==1 {for(i=1;i<=NF;i++) c[$i]=i; print; next} $(c["column"])==col' <out>/tables/columns.tsv
```

Inspect every motif position of one FoldDisco hit, or replace the final condition with `$(c["distanceA"])!="" && $(c["distanceA"])>10` to find distant correspondences:

```sh
awk -F '\t' -v want='<row-id>' 'NR==1 {for(i=1;i<=NF;i++) c[$i]=i; print; next} $(c["rowId"])==want' <out>/tables/residue-distances.tsv
```

The same pattern works for every generated TSV and every named field documented below.

## table-row-coverage

Some tables hold every row of the analysed result, while others hold only the displayed rows; filtering a capped table filters the display, not the result.

| Table | Rows written |
|---|---|
| `hits.tsv` | every row per database, unless `--top` was passed to `hit/table` |
| `candidates.tsv`, `coverage-runs.tsv`, `db-summary.tsv`, `clades.tsv`, `taxon-hits.tsv` | complete |
| `columns.tsv`, `columns-ranked.tsv`, `column-composition.tsv`, `column-residues.tsv`, `members.tsv`, `blocks.tsv`, `pairwise.tsv`, `numbering.tsv` | complete |
| `shortlist.tsv` | top 20 rows per database by default; raise `--top` for more |
| `strata.tsv`, `patterns.tsv`, `residue-distances.tsv`, `hit-distance-summary.tsv`, `residue-distance-summary.tsv`, `intersection.tsv` | complete |

To filter across all FoldDisco rows, rerun `folddisco/shortlist` with a sufficiently large `--top` first.

## common-fields

`dbIndex` is the artifact-local database position; `db` or `database` is its declared id.
Join tables produced from one artifact on `dbIndex`, which every FoldDisco and hit table carries; `database` is the roster id for display and reporting.
`id` or `rowId` is the stable exported-row identifier, while `target` is the server-written target identifier and may repeat.
`rankInDatabase` is 1-based within a database; `rankMerged` exists only when the declared ranking metric is cross-database comparable.
`rankingValue` or `value` uses the ranking field and direction recorded in the result summary.
`seqId` is percent identity on 0–100, while coverage, occupancy, rates, agreement, and retention fields are fractions on 0–1.
`description`, `organism`, `taxName`, and `targetName` are source annotations, not verified biological conclusions.
`qLen` and `dbLen` are the query and target lengths, while `qStartPos`/`qEndPos` and `dbStartPos`/`dbEndPos` are inclusive server-reported alignment endpoints.
Use these fields to review partial alignments, domain boundaries, and disproportionate members; they are evidence for inspection rather than automatic exclusion rules.
These length fields belong to Foldseek hit rows; FoldDisco rows do not currently provide target-chain length.
The largest matched target-residue label locates the motif within a target and is not a chain length or an upper bound on one.

## hit-tables

| Output | Columns and values |
|---|---|
| `db-summary.tsv` | `dbIndex`, `id`; `parsedRows` accepted rows; `rowsRead` scanned rows; `taxonomyTree` boolean; top hit id/target; ranking-value quantiles `q0`, `q25`, `q50`, `q75`, and `q100`. |
| `hits.tsv` | `id`, database fields and ranks; `target`; query and target lengths; inclusive query and target alignment endpoints; ranking `value`; `seqId`; query `coverage`; `taxName`; `description`. |
| `coverage-runs.tsv` | `query`; `queryLength`; inclusive 1-based `from`/`to`; run `len`; hit `depth`; `hitFraction` of that database's hits covering the run. |
| `candidates.tsv` | Candidate `id`, database, target and rank; query and target lengths; inclusive query and target alignment endpoints; `rankingValue`; `seqId`; `coverage`; `organism`; `description`. |
| `clades.tsv` | Taxonomic `rank`, `taxId`, `name`; attributed `hits`; their `fraction`; `identityN`; minimum, median and maximum `seqId`. |
| `taxon-hits.tsv` | Written by `hit/phyletic --taxon`; hit identity and rank; row `taxId`/`taxName`; requested taxon id/name/rank; `distanceToTaxon` ancestry edges; ranking field/value; `seqId`; coverage; description. |

`distanceToTaxon` is `0` for an exact taxon assignment and positive for descendants.
An empty table means zero matches over the whole selected result only when `summary.taxonFilter.assessmentComplete` is true; otherwise inspect `assessedRows`, `unassessedRows`, and the excluded databases.

Inspect exact assignments within an already filtered taxon result:

```sh
awk -F '\t' 'NR==1 {for(i=1;i<=NF;i++) c[$i]=i; print; next} $(c["distanceToTaxon"])==0' <out>/tables/taxon-hits.tsv
```

## hit-set-interpretation

Use Foldseek hit `seqId` and query coverage to form the initial structural diversity for a FoldMason input set.
Only high-identity hits can make conservation uniformly uninformative, while very low identity can weaken alignment and erase a shared signal.
Choose a reasoned spread of moderately similar hits and consult rank, organism, domain context, and description rather than imposing one universal identity interval.
After alignment, use pairwise identity to find realised redundancy; an overly close member can be removed when the intended family scope remains represented.
Use query and target lengths with their aligned spans to identify possible domain truncation, extra domains, or unusually partial coverage before forwarding a member.

A new Foldseek search is justified when the first run cannot represent the databases, taxonomic population, query chain, or search behaviour needed by the question, not merely because another setting returns more hits.
Changing the database roster or `taxFilter` changes the population being searched, so a restricted run cannot support an absence claim outside that scope and database-specific comparisons should use databases shared by both runs.
Changing `mode` or enabling Foldseek `iterativeSearch` changes search behaviour; read each result's ranking semantics and do not compare raw ranks or scores across runs unless the server declares them comparable.
Preserve all attempted result URLs and interpret whether the declared limitation was resolved instead of selecting only the most favourable run.

## msa-tables

| Output | Columns and values |
|---|---|
| `columns.tsv` | 0-based `column`, display-only `oneBased`; `occupancy`; `nonGapCount`; `conservationScore`; identity booleans; `consensusGlyph`; `modalFraction`; `lddt`. |
| `members.tsv` | Entry `index`, `name`, `residueCount`; occupied-column count and fraction; `gapFraction`; amino-acid `consensusAgreement`. |
| `blocks.tsv` | Inclusive 0-based `from`/`to`, display range `oneBased`, `length`, support count, occupancy minimum/mean/maximum, and semicolon-separated `carriers`. |
| `columns-ranked.tsv` | `rank`; column indices and `glyph`; `conservationScore`; space-separated `positive`/`negative` properties; identity booleans; occupancy, support, modal fraction, `lddt`, and entropy. |
| `pairwise.tsv` | Exported reference-entry residue labels `a` and `b` with their 0-based `aColumn` and `bColumn`, and Cα `distanceA` in ångström. |
| `column-composition.tsv` | Column indices, `entryName`, `status`, reference and consensus glyphs, identity and conservation fields, properties, group codes, unmapped properties, and `letters` as `glyph:count:fraction`. |
| `column-residues.tsv` | Each selected column across every alignment member: entry index and name, amino-acid glyph, gap state, 0-based modelled `residueIndex`, and exported residue `label`. |
| `numbering.tsv` | Column indices, `entryName`, `chain`, modelled `residueIndex` and `label`, deposited `authorNumber`/`insertionCode`, residue and alignment-row glyph, and boolean `agrees`. |

## msa-metric-interpretation

`conservationScore` is an integer 0–11, not a probability: 0–9 counts conserved property constraints, 10 is full property conservation without identity, and 11 is amino-acid identity.
The amino-acid score becomes 0 when at least 25% of entries are gaps, and residue types present in no more than `floor(3% of entries)` do not define its property set.
`positive` names properties shared by retained residue types; `negative` names properties absent from all of them.
Use score for order, then inspect property vectors, occupancy, reference glyph, modal fraction, and relevant geometry before choosing a column.
Conservation may reflect structural maintenance, biological function, or both; these measurements do not identify the cause automatically.
Interpret amino-acid chemistry only from the AA representation; 3Di supports structural-alphabet and gap-pattern observations.
`nonGapCount` is support depth; `lddt` and `modalFraction` may be empty when the export supplies no usable value.
Column-composition `status` is `identity`, `variable`, `reference-gap`, or `unscored`; lower-case `a n h p b` are group codes, not amino acids.
`label` is the 1-based modelled-residue position, while deposited author numbering must come from the same structure after sequence agreement is confirmed.

## compactness-interpretation

Compactness checks whether selected reference-entry Cα positions roughly form one spatial neighbourhood and highlights large pairwise distances.
A sharp drop in spread after removing one or more outliers supports review, not automatic exclusion.
Distant residues can belong to a multipart site, interface, or alternate conformation.
Cα distance does not show side-chain orientation, solvent exposure, ligand contact, or metal coordination.

## folddisco-and-reach-tables

| Output | Columns and values |
|---|---|
| `strata.tsv` | Database; matched-residue `nodecount`; `offset = T - nodecount`; `fullMatch`; stratum size `n`; count source `census`; database-local `rate`; RMSD sample size and min/median/mean/max. |
| `patterns.tsv` | Database; 0-based motif residue `index` and label; matched/omitted hit counts; complementary match/omission fractions. |
| `shortlist.tsv` | Per-database rank and ids; `nodecount`, `offset`, `fullMatch`, ranking value, RMSD, and source `description`. |
| `residue-distances.tsv` | One row per hit and motif position; query and target residue labels; `matched` for a non-gap correspondence, `measured` for a usable coordinate pair; transformed target-to-query Cα distance in ångström; descriptive `over5A` and `over10A` flags. |
| `hit-distance-summary.tsv` | One row per hit; matched and gap counts; counts above 5 Å and 10 Å; distance minimum, median, mean, and maximum. |
| `residue-distance-summary.tsv` | One row per query motif residue and database; matched, measured, and gap hit counts; fractions above 5 Å and 10 Å among measured correspondences; distance distribution. |
| `intersection.tsv` | Collection and normalised carrier `base`; `kind`; `matchLevel`; original ids; chain/assembly qualifiers and agreement labels; stripped tokens; row counts; best motif nodes/RMSD; ambiguous `candidates`. |
| `warnings.tsv` | Conditional full affected-id list with warning `code`, canonical `scope`, and affected `id`; warning level and observed facts remain in `result.json`. |

## motif-metric-interpretation

`T` is exported motif width, `nodecount` is matched residues, and full match means offset 0.
A stratum is an exact node-count class rather than a generic near-miss; interpret every RMSD summary with its `n`.
`rate` uses that database's `parsedRows`, so do not pool it across databases or replace unknown with zero.
Raw IDF is length-scaled and comparable only within one database and motif length; shortening usually lowers it.
Lower RMSD supports geometric coherence but neither RMSD nor rarity alone establishes a true positive or biological function.
Residue distance is computed after applying the reported rotation and translation to target Cα coordinates, placing them in the query frame.
Large per-residue distances identify correspondences to review and may indicate a poor local match, which *might* represent false-positive labels.
Retention describes exported hits; low retention can identify a residue that restricts search sensitivity, not biological non-essentiality.
Compare IDF with RMSD, retention, match strata, descriptions, and carrier coherence, especially when a revision changes motif length.
A revision may add or remove several residues when it tests one stated hypothesis about over-specificity, noise, or an excluded candidate.
A modal full-match pattern means only that complete matches are the most frequent exported pattern; it does not establish specificity or biological correctness.
A non-modal full-match pattern can motivate review for an overly restrictive residue or weak retention, but is not a diagnosis by itself.
Saturation is independent of motif specificity, and a tied ranking tier at the export boundary shows cutoff sensitivity rather than whether the motif is too permissive.
Possible under-specificity is supported when full matches remain geometrically or contextually incoherent and a reasoned extension improves discrimination while retaining the intended carriers.
Possible over-specificity is supported when coherent near-matches repeatedly omit the same residue and a reasoned relaxation restores them without losing geometric coherence.
Across different motif lengths, compare self-recovery, intended-carrier retention, geometry, residue distances, strata and carrier coherence; do not treat raw IDF, full-match counts, or rates as directly comparable performance scores.
A bounded sensitivity analysis may compare a small declared set of variants, but it must report every attempted variant and must not select only the one supporting a preferred conclusion.

## reach-vocabulary

Carrier `kind` is `exact`, `normalised`, `ambiguous`, `fold-only`, `motif-only`, or `not-comparable`.
`matchLevel` is `structure` unless the monomer Foldseek–FoldDisco PDB-entry rule applies; entry matches retain assembly, chain, and copy qualifiers.
For chains, one silent side is `chain-agnostic`, two silent sides have no label, shared values are `chain-agreed`, and disjoint values are `chain-mismatch`.
For entry-level assemblies, shared values are `assembly-agreed`, while silence or difference is `assembly-agnostic`; structure-level assembly agreement is empty.
Unrecognised PDB-like shapes remain structure-level and are reported in `summary.matchRule.unparsed`; an ineligible entry key is explained in `summary.matchRule.withheld`.
`queryOrigin.chain` and `options.via[]` record explicit ancestry; there is no implicit discovery.
`basis: session-asserted` means recorded ancestry reached the same exact origin and the current-session assertion supplied only the otherwise missing forwarded-query entry identity.
