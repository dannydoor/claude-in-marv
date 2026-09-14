# workflow-state

**Read when:** creating, changing, or forwarding a selection.

`foldmason-motif-forwarding` owns `select_msa_columns`; other skills reroute to it.
Pass 0-based `column` values, never display-only `oneBased`; the wrong base can still be valid and silently select another motif.

## entry-order

Alignment entry order has no relation to submission order, query identity, or size.
Choose the structure of interest by `name` in QC `members.tsv`, then pass the numeric `index` from that row as `entry` to `select_msa_columns`.
If QC is unavailable, export the alignment and run `msa/member-audit` to obtain the current roster names and indices.
Continue only when the returned `entryName` exactly matches the chosen name.
Pass the verified column selection's `name`, not an entry index, to `send_to`.
For a multi-chain Foldseek source, select the chain through `queries.items[]`; `includeQuery: true` then adds only that selected query chain to FoldMason.

## selection-naming

Use a meaningful new name that reflects the selection's purpose; add a numeric suffix only to avoid a collision found through `action: "list"`, and never reuse a cleared name.
Use copy-on-write and never mutate or delete a selection after forwarding because downstream provenance names it.

## lineage

Destination `derivedFrom` stores the forwarded roster as a snapshot.
Treat that snapshot, not the mutable selection name, as lineage.

## revision-from-lineage

When a downstream result suggests a change, use `derivedFrom` to locate the source ticket and original selection, inspect that selection, and copy it under a new name.
Apply the reasoned change with `add`, `remove`, or `set`, allowing several hits or residues when they test one declared hypothesis, then submit the revised selection and compare the resulting jobs.
Record the source selection, what changed, why it changed, and what the comparison showed.

## hit-selection-validator

`select_hits` has read-only `list` and `describe`, plus mutating `set`, `add`, `remove`, `clear`, `copy`, and `delete`.
Before forwarding, require empty `rejected` and validate the total post-operation `size`:

| Action | Expected size |
|---|---|
| `set` | unique requested ids |
| `add` | previous size plus new unique ids |
| `remove` | previous size minus present requested ids |
| `clear` | 0 |
| `copy` | source size |

Read previous size with `describe` for `add` and `remove`; `delete` instead confirms removal.
`duplicateNames` makes a selection unreadable but does not invalidate the alignment.

## column-selection-validator

For `set`, `add`, `remove`, and `clear`, validate the returned `{name, entryName, selectedColumns, residueCount, gapColumns, residueMapping, motif, droppedSubstitutions?}`; only `copy` returns `size`.

- Expand canonical `selectedColumns` ranges and compare the complete post-operation set.
- Confirm `entryName`.
- Require empty or explicitly accepted `droppedSubstitutions`.
- Compare `residueCount` with selected columns after `gapColumns`; never forward an all-gap empty motif.
- Show `motif` and `residueMapping` before forwarding.

## substitution-case

Lower-case `a n h p b` are residue-group codes; upper-case letters are amino acids.
The server preserves case, so a case change is a different motif rather than cosmetic normalization.
