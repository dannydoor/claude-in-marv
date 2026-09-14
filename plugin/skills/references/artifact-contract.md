# artifact-contract

**Read when:** exported files are needed; summary-only work does not use this reference.

## preflight

1. Call `get_shared_dir`; its `localPath` proves server access, not session access.
2. On the same filesystem, run `node ../../analysis/bin/foldseek-check-access.mjs --shared-root <localPath>` and ask the user to grant access if it exits `2`.
3. Call `export_result`.
4. On the same filesystem, join `localPath` with `descriptor.pathFromMount`; in cloud Cowork use [cowork staging](#cowork-staging).
5. Pass the accessible root as `--shared-root` and its artifact directory as `--artifact-root`.

The CLI verifies containment, `READY`, artifact identity, required roles, and declared byte sizes.

## cowork-staging

Build the device artifact path from `<shared.localPath>/<descriptor.pathFromMount>`.
Call `device_stage_files` with `READY`, `manifest.json`, and the file for every descriptor `files[]` entry; include `access.json` when present and batch if needed.
Use the returned `stagedPath` values to identify the staged artifact and parent root; never invent a cloud path.
The analysis scripts already exist in the cloud shell and are not staged.
If staging is unavailable, ask the user to keep Desktop open and grant the configured folder, then retry once.
Stage again after re-export because staged files are snapshots.

`READY`, `manifest.json`, and `access.json` are metadata, not `files[]` data entries.
A missing `databases[]` roster or non-integer `dbIndex`/`parsedRows` is corruption, not zero hits; an alignment's explicitly empty roster is valid.

## summary-versus-manifest

Manifest-only fields include `exportedRows`, `metricSemantics`, `hasDescription`, `safeName`, catalogue `taxonomy`, and exported `state.queryIdx`.
Summary-only fields include `topHit` and `submission`.
Use manifest provenance for exported analysis and summary provenance for summary-only answers.

## roles-and-cardinality

Find files by `files[].role`, never by path or database-name guesses.

| Tool | Roles |
|---|---|
| Foldseek / Multimer | `databases` always; `rows` per non-empty database; optional `taxonomy` |
| FoldDisco | `databases` and `query-residue-coordinates` always; `rows`, `motif-patterns`, and `residue-geometry` per non-empty database; optional `taxonomy` |
| FoldMason | a healthy completed export normally contains `msa-entries`, `msa-fasta-aa`, `msa-fasta-3di`, `msa-columns`, `msa-residue-map`, `msa-coordinates`, and `msa-tree` |

An absent per-database role is valid when its manifest count is 0 and an error when the count is positive.
Absent taxonomy is never corruption; degrade the claim and name contributing databases.
A completed FoldMason export that lacks AA or 3Di alignment, residue mapping, coordinates, or tree data is incomplete or degraded rather than ordinarily optional.
Missing AA blocks amino-acid and pairwise-identity analysis, missing 3Di blocks structural-alphabet interpretation, and missing columns blocks column analysis.
Missing residue mapping or coordinates blocks geometry and numbering, while missing tree data blocks tree-based interpretation.
Name the absent role and its consequence instead of silently treating the expected output as unnecessary.
A mismatched `dbIndex`, malformed row, parse failure, or `artifactId` mismatch is an error.
Warnings narrow claims but do not stop a run.

## invocation

Flags and display caps are defined in [accepted flags](analysis-cli.md#accepted-flags) and [display caps](analysis-cli.md#display-caps).
`--sort` recomputes cross-database comparability for the chosen field and may withdraw a merged view.

## row-ids

Use `row.id` (`dbIndex#rowIndex`); never synthesise it or assume contiguity.

## taxonomy-availability

Phyletic analysis requires both `taxonomyTree: true` and a `taxonomy` role for that database.
Row-level `taxId`/`taxName` alone is insufficient; report contributing databases and their row coverage.

## saturation

Use manifest `completeness` directly.
Saturated counts are lower bounds; FoldDisco saturation is proven while Foldseek saturation is inferred.

## file-formats

- `result.json` has the common envelope `analysis`, `analysisVersion`, `version`, `input`, optional `options`, command-specific `summary`, output `files`, and `warnings`; its summary records the bounded findings needed to interpret that run and does not replace the export manifest.
- `msa-entries` is `{totalEntries, columns, entries[]}` with each entry's `index`, `name`, `residueCount`, and aligned length.
- Each `msa-residue-map` row names an entry and stores complementary `occupiedColumns` and `gaps` ranges; `tokens` follow occupied columns in modelled-residue order, so the nth expanded occupied column maps to the nth token.
- Residue-map labels are modelled sequence positions, not deposited author numbering; author numbering requires `msa/author-numbering` against the matching structure.
- `msa-coordinates` is a gzipped `{totalEntries, entries[]}` document whose entries carry `index`, `name`, and comma-separated Cα xyz triples in modelled-residue order.
- Multimer chain metrics under `chains[]` differ from top-level metrics.
- Row and column files are streamed and large data stays off stdout.
- `msa/compactness` requires `msa-coordinates` and `msa-residue-map`.
- FoldDisco `query-residue-coordinates` contains query-motif Cα coordinates in motif order.
- Each `residue-geometry` row keeps raw target Cα coordinates, `tmat`, and `umat`; `positions[]` preserves gaps explicitly so compressed coordinates cannot shift to a neighbouring motif residue.
