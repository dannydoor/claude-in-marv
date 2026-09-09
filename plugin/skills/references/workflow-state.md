# workflow-state

**Read when:** creating, changing, or forwarding a selection.

`foldmason-motif-forwarding` owns `select_msa_columns`; other skills reroute to it.
Pass 0-based `column` values, never display-only `oneBased`; the wrong base can still be valid and silently select another motif.

## entry-order

Alignment entry order has no relation to submission order, query identity, or size.
Choose a reference by name and confirm the returned `entryName`; names and residue counts require the exported roster, not the summary.
`includeQuery` forwards the submitted structure, which can differ from the addressed query in multi-chain input.

## selection-naming

Use a new destination name `to-<destination>__NNN`, choosing one above the highest name returned by `action: "list"` and never reusing cleared names.
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
