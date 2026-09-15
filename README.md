# claude-in-marv — Marv plugin for Claude

Run Steinegger lab's field-leading protein structure analysis tools from Claude, then analyse exported results locally.

The plugin contains 9 skills and a local analysis CLI.
Claude Code can start the bundled MCP runtime; Cowork uses a separately installed Desktop extension.

## Requirements

- Claude Code, or Claude Cowork with Claude Desktop open and the matching MCPB installed.
- Access to the public Foldseek Search Server deployment, or another compatible deployment URL.
- The default `~/marv-shared` folder, or another folder selected during MCPB installation.
- Node.js 18 or newer for local analysis.

Before analysis, the plugin asks the MCP server for its verified shared-directory path and checks the current session's access separately.
Claude Code can read a permitted local shared folder directly.
Cowork sessions have a separate cloud filesystem: Claude stages each exported artifact through the Desktop device bridge before running analysis, and asks you to reconnect Desktop or grant the folder if that bridge cannot read it.
The server uses `~/marv-shared` unless overridden.

## Quick install

### Claude Code

Add the public marketplace, install the plugin, and reload the active session:

```text
/plugin marketplace add dannydoor/foldseek-claude-plugin
/plugin install claude-in-marv@steinegger-lab
/reload-plugins
```

### Claude Cowork in the Desktop app

Cowork needs two installations because its cloud session does not execute the MCP runtime bundled in the plugin:

1. [Download `marv-api-v0.2.0.mcpb`](https://github.com/dannydoor/foldseek-claude-plugin/releases/download/v2.1.0/marv-api-v0.2.0.mcpb) from this plugin's release.
2. In Claude Desktop, open **Settings → Extensions → Advanced settings → Install Extension…**, select the MCPB and keep Desktop open.
3. Open **Cowork → Customize → Plugins → + → Add marketplace**, then add `https://github.com/dannydoor/foldseek-claude-plugin` from a repository.
4. Install **claude-in-marv** from **steinegger-lab**, then start a fresh Cowork session.
5. When asked, allow Desktop to use `~/marv-shared` or the override chosen during MCPB installation.

Plugin 2.1.0 requires MCPB 0.2.0.
Both installable files are produced from the same checked-in MCP runtime and published together.

You can alternatively [download the `.plugin` file](https://github.com/dannydoor/foldseek-claude-plugin/releases/download/v2.1.0/claude-in-marv-v2.1.0.plugin) from the same release and upload it from the Plugins page.

### Local checkout

```bash
claude --plugin-dir ./plugin
```

See `CONTRIBUTING.md` for the manual build and verification procedure.

After installing or updating the plugin, start a fresh Claude session and ask:

> List the Foldseek databases available for a motif search.

A missing-tool error means the MCP server is not registered for that client.
If Cowork can query a result but cannot stage its export, verify that Desktop is open and can access the configured folder.

## Results

Summaries answer many questions without exporting full results.
When complete rows, columns, taxonomy or coordinates are needed, `get_shared_dir` reports the verified device location and the server writes an artifact there.
Claude Code checks and reads a permitted local path; Cowork copies the files declared by `export_result` through `device_stage_files` and analyses the staged snapshot.
Analysis runs write `result.json`, named TSV files and provenance into a new run directory; nothing is removed automatically.

## Repository layout

```text
.claude-plugin/  marketplace metadata for this repository
mcpb/            Desktop-extension manifest and installation notes
plugin/          the complete installable Claude plugin payload
test/            focused interface, safety and release tests
tools/           repository checks and verified packaging
```

## Development

Run `npm test` and `npm run check`.
Linux is the release-authoritative environment; CI also builds the same `.plugin` archive for inspection.
See `CONTRIBUTING.md` for runtime import and release rules.

## License

GPL-3.0-or-later.
See `LICENSE`.

Foldseek, FoldMason and Folddisco are developed by the Steinegger Lab.
This repository provides a Claude client and analysis layer; it does not reimplement those algorithms.
