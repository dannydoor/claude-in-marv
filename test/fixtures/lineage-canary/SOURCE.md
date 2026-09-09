# lineage-canary — captured, never constructed

The three manifests were copied verbatim from artifact roots exported by the live server on 2026-09-02.
Nothing here was authored: `derivedFrom` is the evidence the origin check verifies.

| file | ticket | tool | `derivedFrom` |
|---|---|---|---|
| `A1-foldseek.manifest.json` | `fUixtokkLHJiCeKaGzQOjdOOaSmYpBbYr0i7bw` | foldseek | `null` — its own origin |
| `A2-foldmason.manifest.json` | `96CMmZMi1tlT1lea8KI5yhG4jdyPdnoDZjFAwg` | foldmason | names A1's ticket **with** `queryIdx` 0 |
| `A3-folddisco.manifest.json` | `Sw7hyL7dIPUeVjCzRcZbJhDvfWOZ_VhmFunLow` | folddisco | names **A2's** ticket, `origin: "fm-entry"`, and **no `queryIdx`** |

A3 shows why ancestry needs more than one hop: one hop resolves the motif side to A2 and the fold side to A1, so the two sides disagree on a pair that really is one query.
Only the manifests are kept — the origin resolver reads recorded ancestry and no rows, so the row files would be dead weight.
Only these manifests are kept in the repository; the full roots with their rows were the run's own exports and were not retained.
