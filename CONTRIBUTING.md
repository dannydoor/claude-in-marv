# Contributing

## Local checks

Use Node.js 18 or newer.
The release-authoritative environment is Linux with Node.js 22.

```bash
npm test
npm run check
npm run package
```

`plugin/` is the complete installable payload.
Repository documentation, tests and tools must not be imported or cited by files under `plugin/`.

## Test scope

The public suite covers packaging, the vendored MCP interface, filesystem boundaries, archive contents, skill structure and the small lineage and identifier cases that protect result interpretation.
Keep large captures and exploratory regression corpora outside this repository.
Add a compact public test only when it protects a supported interface, safety property or scientific interpretation rule.

## Rules

- Keep skill descriptions short and user-facing.
- Keep source comments focused on the current invariant, not defect or migration history.
- Keep analysis rules fixed and name every structural invariant that contains a numeric limit.
- Preserve explicit refusal paths and verify every release member against its reviewed source.
- Change the version only in `plugin/.claude-plugin/plugin.json`; the marketplace entry inherits it.

The MCP server is maintained in the MMseqs2-App repository.
Changes that require a new server contract must identify the compatible upstream commit.

## MCP runtime updates

For a manual import, build the runtime locally from a clean MMseqs2-App checkout at a named commit.
From that checkout's repository root:

```bash
git status --short
npm ci --prefix frontend/lib
npm ci --prefix mcp/core
npm ci --prefix mcp/server
npm run build:plugin-runtime --prefix mcp/server
sha256sum mcp/server/dist/marv-api-runtime-v<version>.zip
git rev-parse HEAD
```

Do not import an artifact while `git status --short` reports source changes.
In this repository, import the verified ZIP and bind it to the full commit without claiming that an upstream release exists:

```bash
npm run import:mcp -- \
  --artifact /path/to/marv-api-runtime-v<version>.zip \
  --sha256 <artifact-sha256> \
  --source-kind local-build \
  --upstream-commit <full-commit>
```

The importer records `source.kind: local-build`, a null upstream tag, the commit, the artifact digest and every vendored file digest.
Regular CI and release jobs package the checked-in files and never fetch from MMseqs2-App.
For a reviewed update, tag the accepted MMseqs2-App commit as `mcp-v<version>` and manually run `sync-mcp-runtime.yml` with that tag.
The workflow checks out the tagged source, verifies the server version, builds and imports the runtime, synchronizes MCPB and README metadata, and opens a review pull request rather than changing the default branch directly.
It then verifies both distributions in the update workflow; subsequent human changes to the pull request are checked by regular pull-request CI.
Its provenance uses `source.kind: source-build` and records both the source tag and resolved commit; no GitHub Release is implied.
The workflow never force-pushes an existing update branch, so add contract, skill and changelog changes to the generated pull request without rerunning that tag.

The plugin runtime is also the executable payload of the Desktop `.mcpb`.
It contains exactly the entry point, a `server.mjs` with the MCP SDK and all other dependencies bundled, `package.json`, `LICENSE`, and generated third-party notices.
This keeps SDK examples, types, and an installed `node_modules` tree out of the plugin payload without dropping dependency attribution.
The repository adds only `mcpb/manifest.json` and `mcpb/README.md` when packaging the separate Desktop artifact.

The importer changes `.mcp.json`, `mcp-version.json`, the MCP settings in the plugin manifest and the exact five files under `vendor/marv-api/` as one reviewed change.
`GITHUB_REPOSITORY=OWNER/REPOSITORY npm run sync:mcp-metadata` then aligns the MCPB manifest version and the repository-specific README download and compatibility text.

## Manual plugin release

After importing the runtime, validate and build on Linux:

```bash
npm test
npm run check
claude plugin validate ./plugin
npm run package:all
sha256sum dist/claude-in-marv-v<cur_version>.plugin
sha256sum dist/marv-api-v<mcp_version>.mcpb
```

Each packager checks the archived member list and compares every member with its reviewed source.
If the release workflow is rerun for an existing tag, it verifies the published checksums and compares member names and contents while ignoring ZIP metadata; matching assets succeed without replacing the existing release.

Marketplace installation uses the checked-in `plugin/` directory; the `.plugin` file is a separate direct-install artifact.

A public tag must equal the plugin manifest version; `npm run check:release -- v<cur_version>` checks that metadata and the bundled runtime.
The manual release workflow publishes the plugin and matching Desktop MCPB together from the checked-in runtime.
