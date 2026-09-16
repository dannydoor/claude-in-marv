# mcp-contract

**Read when:** calling a Marv API MCP tool.

## tool-surface

- Read: `get_shared_dir`, `list_databases`, `get_ticket_status`, `get_result_summary`, `export_result`.
- Submit: `foldseek_search`, `multimer_search`, `foldmason_msa`, `folddisco_search`.
- Mutate/forward: `select_hits`, `select_msa_columns`, `send_to`.

Submit tools and `send_to` return after queueing.
Match exposed tools by the logical name suffix; host prefixes are not stable or provenance.

## query-index

`queryIdx` is an integer defaulting to 0; single-unit jobs refuse non-zero values.
FoldMason, FoldDisco, and not-ready summaries omit `queryIdx`; do not synthesize zero.
Complete Foldseek and Multimer summaries and manifests report `queries.count` and may include bounded `queries.items[]` entries that map each `queryIdx` to its source `chain`.
For a multi-chain query, choose the chain of interest from this mapping and keep its `queryIdx` unchanged through summary, export, hit selection, and forwarding.
If `queries.items` is absent or the relevant `chain` is `null`, do not infer chain order; require an explicit `queryIdx` from the user.
When Foldseek hits are sent to FoldMason with `includeQuery: true`, the bundled Marv API runtime adds only the selected query chain for that `queryIdx`.

## response-channels

Check `isError`, then `code`, then `ok`.

| Response | Action |
|---|---|
| `{isError: true, code, error}` | stop and report the server code and message |
| `RESULT_NOT_READY` with `next` | poll the named tool |
| `RESULT_FAILED` with `next` | terminal; stop |
| `{ok: false, problems[]}` | correct the submission and resubmit |
| otherwise | continue |

Branch specially only for `QUERY_IDX_OUT_OF_RANGE`, `INVALID_QUERY_IDX`, `RESULT_NOT_READY`, `RESULT_FAILED`, and `INPUT_PATH_REFUSED`.
For all other codes, including `INTERNAL_ERROR` and `UNSUPPORTED_TOOL`, stop and report the response without inventing recovery.

## polling

Only `get_ticket_status` determines terminality: `PENDING`/`RUNNING` continue, `COMPLETE` proceeds, and `ERROR`/`UNKNOWN` stop.
Then call `get_result_summary`; export only when rows, columns, taxonomy, or coordinates are required.
`export_result` returns a descriptor, not file contents; analysis skills own artifact access and never open data files directly.
`get_shared_dir` returns verified device paths, but current-session access still requires [artifact preflight](artifact-contract.md#preflight).

## databases

Call `list_databases({tool})` before submission and use returned ids; availability varies by tool and deployment.
`validateOnly: true` checks the exact input intended for submission without creating a ticket; do not use it as a residue-lookup mechanism, and it does not prove that a database combination is valid.
`send_to` also takes `databases`; FoldDisco forwarding requires at least one motif-capable database and refuses omission or ineligible paths before creating a job.
`dbIndex` is result order, not submitted-list position.
A Foldseek, Multimer, or FoldDisco job may use a reasoned expanded or revised database set; record that set and compare database-specific metrics only where the rosters align.

## search-settings

`foldseek_search` accepts `mode` values `3diaa`, `tmalign`, or `lolalign`, plus optional `iterativeSearch` and `taxFilter`.
`multimer_search` accepts the same modes and `taxFilter` but refuses `iterativeSearch`.
`folddisco_search` refuses `mode`, `iterativeSearch`, and `taxFilter` rather than ignoring them.

A sequence of revised searches is not the same thing as setting `iterativeSearch: true` on one Foldseek submission.
When the first result cannot answer the question, preserve it and submit a new ticket with a reasoned change to the database roster, mode, taxonomy filter, query chain, or Foldseek iterative-search option.
Treat each setting as a separate comparison axis and change one at a time where practical.
Run `validateOnly: true` on the exact revised input, then record the old and new result URLs, the changed setting, and the reason.
After a mode change, read the new result's `ranking` object again instead of carrying over score direction or comparability from the earlier run.

## zero-hit

`parsedRows: 0` at a resolved index is a valid result: report it without warning or export.
`complete` is normally `null`, is `false` only when saturated, and is `true` only for FoldMason.
Index errors are not zero hits, and zero query length without a header does not prove an unresolved index.

## row-order

Rows follow `ranking.field`; read its label, direction, and cross-database comparability from the summary.
For example, `eval` under `3diaa` is lower-is-better and not cross-database comparable, while under `tmalign` it is higher-is-better and comparable.
Summary database entries contain `dbIndex`, `id`, `display`, `version`, `taxonomyTree`, `parsedRows`, and `topHit`; `completeness` is top-level.

## input-origins

Foldseek, Multimer, and FoldDisco accept exactly one of `query`, `queryRef`, or `accession`; prefer accession, then stored reference, then inline text.
`queryRef` and FoldMason `fileRefs` are paths relative to the shared directory's `imports/` folder.
Place a custom query structure under `imports/` and pass its relative path rather than a device-absolute or cloud-absolute path.
FoldMason may mix `files`, `fileRefs`, and `accessions`.

| Origin | Verify |
|---|---|
| `queryRef` | returned `loaded.name` and `loaded.bytes` equal the local file |
| accession | record resolved id, source, name, bytes, and any motif; Q-BioLiP lookup occurs only with explicit motif or `autoMotif: true` |
| inline query | `would.queryBytes` or `submission.queryBytes` equals sent UTF-8 bytes; no `loaded` field |
| FoldMason files/references | `submission.files[]` name-and-byte roster matches inputs |
| FoldMason accessions | record resolved count and names; byte equality is unavailable |
| mixed FoldMason | apply each origin rule and record assembled order |

An automatically resolved Q-BioLiP motif is a structure-contact-derived binding-site annotation; use it as a motif candidate if needed, but not as independent evidence of biological function, and inspect its returned residues before submission.

## foldmason-entry-shape

Direct `foldmason_msa` accession loading does not apply the multichain encoding used when selected search hits are forwarded through `send_to`.
FoldMason can therefore expand chains from a directly loaded accession into separate entries, while an explicitly encoded forwarded multichain hit can remain one entry.
Treat the completed `msa-entries` roster as authoritative and never infer entry count from accession count or chain count alone.

## taxonomy-filters

Pass scientific names or numeric ids through `taxFilter` and record the returned mapping; there is no local taxonomy lookup.
For an ambiguous common name, show returned candidates and ask for a numeric id.
Resolved ids are strings while row `taxId` is numeric, so coerce when joining.
`taxFilter` constrains a new search, while `hit/phyletic --taxon <NCBI-tax-id>` filters an exported result through its supplied taxonomy tree without changing the ticket.
FoldDisco accepts none of `taxFilter`, `mode`, or `iterativeSearch` and refuses them rather than ignoring them.
