#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.FOLDSEEK_SERVER_BASE_URL ||= 'https://search.foldseek.com';
process.env.FOLDSEEK_SERVER_SHARED_DIR ||= path.join(os.homedir(), 'foldseek-server-shared');

const entries = [
    new URL('../vendor/foldseek-server/scripts/foldseek-server-mcp.js', import.meta.url),
    new URL('../vendor/foldseek-server/bin/foldseek-server-mcp.js', import.meta.url),
];
const entry = entries.find(candidate => fs.existsSync(candidate));
if (!entry) throw new Error('the bundled Foldseek MCP entry point is missing');
await import(entry.href);
