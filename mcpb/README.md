# Marv API desktop extension

Use Foldseek for monomer and complex structure searches, FoldMason for multiple-structure alignment and FoldDisco for 3D motif searches through Claude Desktop.

## Installation

In Claude Desktop, open **Settings → Extensions → Advanced settings → Install Extension…** and select this `.mcpb` file.
The public Foldseek Search Server and `~/marv-shared` are the defaults; either can be changed during installation.

Install the matching claude-in-marv Claude plugin to add guided analysis skills and local analysis commands.
Cowork requires this Desktop extension because its cloud session does not run the MCP server bundled with the plugin.

## Shared files

The shared folder contains `imports/` for custom input structures and `exports/` for exported result artifacts.
Grant Claude Desktop access to the configured folder before using local files.

## Source and license

The MCP server source is maintained in [MMseqs2-App](https://github.com/soedinglab/MMseqs2-App).
The companion plugin and release checksums are published in [foldseek-claude-plugin](https://github.com/dannydoor/foldseek-claude-plugin).
The server is distributed under GPL-3.0-or-later; bundled dependency notices are included.
