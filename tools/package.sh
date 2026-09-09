#!/usr/bin/env bash
# Build dist/<name>-v<version>.plugin, then verify the archive against the boundary contract.
# Not `zip -r`: a directory sweep is how fixtures and planning docs reach a release.
#
# Membership and every shipped-content rule live in tools/boundary.mjs, which test/unit/boundary.test.mjs
# imports as well — so this script and that test cannot enforce different contracts, and neither can
# claim a check the other lacks.
#
# Usage: package.sh [--check-only]
#
# Portable to bash 3.2, which is the /bin/bash macOS ships. No `mapfile`, no associative array, no `${x^^}`
# — a release script that only runs on a Homebrew bash is a release script most users cannot run.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$ROOT/plugin"
MANIFEST="$PLUGIN/.claude-plugin/plugin.json"

command -v zip >/dev/null || { echo "zip not found" >&2; exit 1; }
command -v node >/dev/null || { echo "node not found" >&2; exit 1; }
[[ -f "$MANIFEST" ]] || { echo "no manifest at $MANIFEST" >&2; exit 1; }

NAME=$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST" | head -1)
VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST" | head -1)
OUT="$ROOT/dist/${NAME}-v${VERSION}.plugin"

# One authority for what ships and what may appear in a shipped file. A finding here is fixed in the
# tree, never filtered at zip time.
if ! BOUNDARY=$(node "$ROOT/tools/boundary.mjs" "$PLUGIN" 2>&1); then
  echo "$BOUNDARY" >&2
  echo "refusing to build: fix the tree, not the zip" >&2
  exit 1
fi
echo "$BOUNDARY"

# `mapfile` is bash 4. Read the list with a loop and count as we go, so that every later expansion of
# the array happens on a known-non-empty array — an empty array under `set -u` is itself an error on 3.2.
files=()
count=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  files[$count]="$line"
  count=$((count + 1))
done < <(printf '%s\n' "$BOUNDARY" | sed -n 's/^   //p')
[ "$count" -gt 0 ] || { echo "boundary reported no files" >&2; exit 1; }

# Required regardless of what the tree happens to contain.
for required in ".claude-plugin/plugin.json" "CHANGELOG.md" "LICENSE"; do
  printf '%s\n' "${files[@]}" | grep -qxF "$required" || {
    echo "MISSING required file: $required" >&2; exit 1; }
done

[[ "${1:-}" != "--check-only" ]] || exit 0

BUILD_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/foldseek-plugin.XXXXXX")
trap 'rm -rf "$BUILD_ROOT"' EXIT
STAGE="$BUILD_ROOT/plugin"
TMP_OUT="$BUILD_ROOT/$(basename "$OUT")"
mkdir -p "$STAGE"
for file in "${files[@]}"; do
  mkdir -p "$STAGE/$(dirname "$file")"
  cp -p "$PLUGIN/$file" "$STAGE/$file"
done

# Git does not preserve mtimes, and ordinary ZIP extra fields carry host ids and access times. Build
# from fixed metadata so the same tracked bytes produce the same release archive on every Linux runner.
find "$STAGE" -exec touch -t 198001010000 {} +
cd "$STAGE"
TZ=UTC zip -X -q "$TMP_OUT" "${files[@]}"

diff <(printf '%s\n' "${files[@]}" | sort) <(unzip -Z1 "$TMP_OUT" | sort) \
  || { echo "archive does not match the boundary" >&2; exit 1; }

for file in "${files[@]}"; do
  unzip -p "$TMP_OUT" "$file" | cmp - "$PLUGIN/$file" \
    || { echo "archive content differs from source: $file" >&2; exit 1; }
done

mkdir -p "$ROOT/dist"
cp -f "$TMP_OUT" "$OUT"
cmp "$TMP_OUT" "$OUT" || { echo "copied archive differs from the verified build" >&2; exit 1; }

echo
echo "── $OUT  ($(du -h "$OUT" | cut -f1), $(wc -c <"$OUT" | tr -d ' ') bytes)"
echo "   skills     $(cat skills/*/SKILL.md 2>/dev/null | wc -l | tr -d ' ') lines total   (ceiling 120; fold-vs-motif-reach 127 by exception)"
for f in skills/*/SKILL.md; do
  skill=$(basename "$(dirname "$f")")
  lines=$(wc -l <"$f" | tr -d ' ')
  cap=120
  [ "$skill" != "fold-vs-motif-reach" ] || cap=127
  over=""
  [ "$lines" -le "$cap" ] || over="  OVER $cap"
  printf '     %-32s %4s%s\n' "$skill" "$lines" "$over"
done
reference_count=$(find skills/references -maxdepth 1 -type f -name '*.md' | wc -l | tr -d ' ')
echo "   references $(cat skills/references/*.md 2>/dev/null | wc -l | tr -d ' ') lines total   ($reference_count files, budget 340–600)"
for f in skills/references/*.md; do
  printf '     %-32s %4s\n' "$(basename "$f")" "$(wc -l <"$f" | tr -d ' ')"
done
echo
echo "Reinstall, then start a fresh session."
