#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.MARV_BASE_URL ||= 'https://search.foldseek.com';
process.env.MARV_SHARED_DIR ||= path.join(os.homedir(), 'marv-shared');

const entries = [
    new URL('../vendor/marv-api/scripts/marv-mcp.js', import.meta.url),
    new URL('../vendor/marv-api/bin/marv-mcp.js', import.meta.url),
];
const entry = entries.find(candidate => fs.existsSync(candidate));
if (!entry) throw new Error('the bundled Marv API runtime entry point is missing');
await import(entry.href);
