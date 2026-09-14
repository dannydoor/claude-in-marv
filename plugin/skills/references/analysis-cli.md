# analysis-cli

**Read when:** running or interpreting a local analysis subcommand.

## entry-point

Run the bundled script from a skill or this reference directory; it is not on `PATH`.
In cloud Cowork the script is already in the cloud shell and `CLAUDE_PLUGIN_ROOT` is unset.

```sh
node ../../analysis/bin/foldseek-analyze.mjs <group> <subcommand> \
  --shared-root <accessible-root> --artifact-root <artifact-root> --out <new-or-empty-directory>
```

The artifact directory is named by `manifest.artifactId`, `--out` must not be inside it, and [artifact preflight](artifact-contract.md#preflight) applies.
Exit `0` writes `result.json`, `run.json`, and named tables; exit `1` is an artifact or analysis refusal; exit `2` is a correctable invocation or policy refusal.
Neither refusal writes a bundle, and warnings do not change the exit status.

## accepted-flags

Undeclared flags are refused rather than ignored.

| Flag | Accepted by | Meaning |
|---|---|---|
| `--shared-root` `--artifact-root` `--out` | all | access boundary, input artifact, output directory |
| `--query-idx <n>` `--sample <n>` | all | confirm query index; cap warning samples |
| `--db <index-or-id>` | `hit/*` | choose a database from an artifact without an alignment roster |
| `--taxon <NCBI-tax-id>` | `hit/phyletic` | emit hits assigned to that taxon or a descendant through the exported taxonomy tree |
| `--sort <field>` `--top <n>` | `hit/table` | alternative ranking; rows shown per database |
| `--top <n>` | `msa/blocks`, `msa/column-ranking`, `folddisco/shortlist` | rows / columns shown |
| `--columns <list>` | `msa/compactness`, `msa/column-composition`, `msa/column-residues`, `msa/author-numbering` | required candidate columns |
| `--reference <name>` | `msa/compactness` | required geometry entry name |
| `--entry <name>` | `msa/column-composition`, `msa/author-numbering` | required MSA row name |
| `--structure <path>` | `msa/author-numbering` | required caller-supplied PDB file |
| `--against <root>` `--via <root>` `--assert <type>:<payload>` | `workflow/reach` | comparison artifact; repeatable ancestry root; repeatable run-scoped assertion |

## selectors

`--columns` takes unique **0-based** `column` values in request order; `oneBased` is display only and must never be passed.
`--reference` and `--entry` identify entries by name, never by position or query index.
`--taxon` takes one positive numeric NCBI taxonomy id; names are display annotations and are never resolved locally.

## reach-assertions

Prefer recorded ancestry and provide every intermediate explicitly with repeated `--via`.
The server-generated FoldMason query entry names `query`, `query_<chain>`, and an encoded multimer whose exact stem is `query` resolve through recorded ancestry without an assertion.
The encoded suffix is kept opaque rather than revalidated here; other names are not promoted merely because they look query-like.
`--assert origin:session` is allowed only when the agent submitted both sides in the current uninterrupted session and ancestry already converges on the same ticket and query index.
It may identify the otherwise unproven forwarded-query entry, but cannot bypass missing or duplicate intermediates, malformed lineage, cycles, or different origins; a successful use reports `basis: session-asserted`, the exact origin pair, the consumed chain, and the asserted entry.
If those session conditions are not met, require `origin:left=<ticket>/<queryIdx>,right=<ticket>/<queryIdx>` from the user.
Database equivalence remains a separate `db-equivalence:<left>=<right>` assertion and never establishes query origin.

## display-caps

`--top` and `--sample` limit only displayed rows, columns or ids; summaries retain full counts and decisions.
For `hit/table` and `folddisco/shortlist`, `--top` applies per database after ordering.
`hit/table` includes each server-provided `description`, previews up to five ranked hits, and reports description coverage; descriptions are annotations, not established functions.

Field definitions, value domains, interpretation guidance, and reusable TSV queries are in [analysis-output interpretation](interpretation.md#tsv-query-patterns).
