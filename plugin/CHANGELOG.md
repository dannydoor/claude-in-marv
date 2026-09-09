# Changelog

## 2.0.0 — 2026-09-08

Runs Foldseek, Multimer, FoldMason and Folddisco through the Foldseek MCP server, and analyses exported results with a local CLI.

### Requires

- Claude Code uses the pinned MCP runtime bundled here.
  Cowork requires the server version in `mcp-version.json` as a separate Desktop MCPB.
- The server writes to `foldseek-server-shared` under the current user's home unless overridden.

### Nine skills

- `server-operations` — Foldseek, Multimer, FoldMason and FoldDisco jobs: databases, validated submission, polling, summaries, exports, hit selections and forwarding.
  It cannot select columns; that reroutes to `foldmason-motif-forwarding`.
- `foldseek-hit-analysis` — a finished hit table: which databases carry signal, how the ranking field spreads, per-residue query coverage and observations for an explicit member choice.
- `foldseek-phyletic-profile` — clade counts, coverage, evenness, per-clade sequence-identity ranges and optional hit extraction by NCBI taxon ancestry.
- `foldmason-qc` — reports occupancy, conservation, identity, coverage, and agreement observations for an alignment without collapsing them into a categorical grade.
- `foldmason-conserved-site` — ranks columns by conservation and reports geometry as a separate annotation for an explicit residue choice.
- `foldmason-motif-forwarding` — chosen MSA columns into a FoldDisco search against a named reference entry, the returned motif and residue mapping verified first.
  The only skill that calls `select_msa_columns` or forwards to FoldDisco.
- `folddisco-analysis` — a finished motif hit table: motif coverage, RMSD distributions, residue retention, gap-aware residue distances and candidates for manual review.
- `fold-vs-motif-reach` — intersects a fold-level carrier set with a motif-level one, establishing a common query first.
- `structural-analysis-workflow` — sequences the other eight for an end-to-end goal and permits reasoned, recorded revisions of the member or residue selection.

### Local analysis

`foldseek-analyze` reads an exported artifact and writes a deterministic `result.json` and its tables, under the subcommand groups `hit/`, `msa/`, `folddisco/` and `workflow/`.
It reports observations and candidates without choosing them.
The skills require explicit criteria and a named choice before MCP tools save a selection.

### Upgrading from 1.x

**Breaking, and 2.0.0 keeps the 1.x plugin name — installing it displaces 1.8.x rather than joining it.** Never have both installed, and start a fresh session after installing.

1.x drove the Foldseek web interface through in-page JavaScript and required a browser; 2.0.0 requires an MCP server and no browser.
No configuration or workflow carries over.
