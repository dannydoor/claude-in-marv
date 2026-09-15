# Changelog

## 2.1.0 — 2026-09-15

Renamed. The plugin is `claude-in-marv`, published from the `steinegger-lab` marketplace, and the server it bundles is `Marv API`.
This release also incorporates workflow improvements identified during an end-to-end trial.

### Requires

- MCP runtime 0.2.0. Claude Code uses the pinned runtime bundled here; Cowork requires the matching Desktop MCPB.
- The server writes to `marv-shared` under the current user's home unless overridden.

### Changed

- **Breaking.** Install as `claude-in-marv@steinegger-lab`, not `foldseek-server@foldseek-server-tools`. Claude treats the renamed plugin as a different plugin: remove the old one, install this one, and start a fresh session.
- **Breaking.** The bundled server declares itself `Marv API`, so its tools are namespaced `Marv_API` instead of `Foldseek_Server`. Anything that named the old prefix must be updated.
- **Breaking.** Server configuration is `MARV_*` instead of `FOLDSEEK_SERVER_*`; the state directory is a `.marv` folder and the shared folder is `marv-shared`, both under the current user's home. Results, selections and exports cached under the old paths are neither read nor migrated.
- Release files are `claude-in-marv-v2.1.0.plugin` and `marv-api-v0.2.0.mcpb`.
- The `Server URL` setting now reads "Foldseek Search Server": it names the upstream deployment being searched, not the server this plugin bundles.

### Analysis and workflow improvements

- Multi-chain Foldseek and Multimer results expose the query-chain mapping, preserve the selected `queryIdx`, and add only that selected query chain when forwarding hits to FoldMason.
- Hit and member-candidate tables now include query and target lengths plus aligned spans for detecting partial alignments, domain mismatches, and length outliers.
- `msa/column-composition` replaces the former substitution-oriented command and reports residue frequencies, conserved properties, occupancy, and reference context without choosing a motif automatically.
- The new `msa/column-residues` table maps shortlisted columns across all alignment members, including gaps and modelled residue labels.
- Alignment guidance now asks the agent to reconsider redundant, divergent, gap-rich, or wrong-domain member sets when they obscure a useful conservation signal.

## 2.0.0 — 2026-09-08

Runs Foldseek, Multimer, FoldMason and Folddisco through the Foldseek MCP server, and analyses exported results with a local CLI.

### Requires

- Claude Code uses the pinned MCP runtime bundled here.
  Cowork requires the server version in `mcp-version.json` as a separate Desktop MCPB.
- The server writes to `marv-shared` under the current user's home unless overridden.

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
Hit candidate tables include query and target lengths and aligned spans for domain and partial-alignment review.
Column composition and per-member residue mapping expose the evidence behind a column choice without proposing a motif automatically.
The skills require explicit criteria and a named choice before MCP tools save a selection.

### Upgrading from 1.x

**Breaking, and 2.0.0 keeps the 1.x plugin name — installing it displaces 1.8.x rather than joining it.** Never have both installed, and start a fresh session after installing.

1.x drove the Foldseek web interface through in-page JavaScript and required a browser; 2.0.0 requires an MCP server and no browser.
No configuration or workflow carries over.
