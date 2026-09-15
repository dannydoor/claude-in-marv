// The shipped-tree boundary contract, in one place. `package.sh` runs this and refuses to build on any
// finding; `test/unit/boundary.test.mjs` imports the same functions. Neither can drift from the other,
// and neither may claim a check the other lacks.
//
//   node tools/boundary.mjs [plugin-dir]
//
// Never shipped: this file lives under tools/.

import fs from 'node:fs';
import path from 'node:path';

const MCP_RUNTIME_FILES = new Set([
    'vendor/marv-api/LICENSE',
    'vendor/marv-api/THIRD_PARTY_NOTICES.md',
    'vendor/marv-api/bin/marv-mcp.js',
    'vendor/marv-api/scripts/marv-mcp.js',
    'vendor/marv-api/dist/server.mjs',
    'vendor/marv-api/package.json',
]);
const isMcpRuntime = p => MCP_RUNTIME_FILES.has(p);
const isMcpLauncher = p => p === 'scripts/start-marv-api.mjs';

// ---------------------------------------------------------------- archive membership

// Precise rules, not a directory sweep. `depth` counts path segments below plugin/.
// Adding a row here is a deliberate act.
export const SHIP = [
    { label: '.claude-plugin/plugin.json', test: p => p === '.claude-plugin/plugin.json' },
    { label: '.mcp.json', test: p => p === '.mcp.json' },
    { label: 'mcp-version.json', test: p => p === 'mcp-version.json' },
    { label: 'scripts/start-marv-api.mjs', test: isMcpLauncher },
    { label: 'CHANGELOG.md', test: p => p === 'CHANGELOG.md' },
    { label: 'LICENSE', test: p => p === 'LICENSE' },
    { label: 'skills/<skill>/SKILL.md', test: p => /^skills\/[^/]+\/SKILL\.md$/.test(p) && !p.startsWith('skills/references/') },
    { label: 'skills/references/<name>.md', test: p => /^skills\/references\/[^/]+\.md$/.test(p) },
    { label: 'analysis/bin/<name>.mjs', test: p => /^analysis\/bin\/[^/]+\.mjs$/.test(p) },
    { label: 'analysis/src/**/<name>.mjs', test: p => /^analysis\/src\/(?:[^/]+\/)*[^/]+\.mjs$/.test(p) },
    { label: 'analysis/data/reach-v1.json', test: p => p === 'analysis/data/reach-v1.json' },
    { label: 'vendor/marv-api release files', test: isMcpRuntime },
];

// Explicitly rejected, and checked BEFORE the ship rules so a test module under analysis/src cannot
// enter the archive through the module row.
export const REJECT = [
    { label: 'a test or spec module', test: p => /\.(test|spec)\.mjs$/.test(p) },
    { label: 'a test or fixture directory', test: p => /(^|\/)(__tests__|__fixtures__|fixtures|test|tests)\//.test(p) },
    { label: 'an editor or OS artifact', test: p => /(^|\/)(\.DS_Store|\._.*|.*\.swp)$/.test(p) },
    { label: 'a planning or evidence document', test: p => /(^|\/)(plan|checklist|evidence|context|dispositions|source-pins|handoffs?)\.[a-z]+$/.test(p) },
];

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
});

// Every regular file under plugin/ is shipped, or explicitly rejected, or a finding. Nothing is
// silently left out — that is how a helper a skill imports disappears from the archive.
export function classify(pluginDir) {
    const root = path.resolve(pluginDir);
    const all = walk(root).map(f => path.relative(root, f).split(path.sep).join('/')).sort();

    const shipped = [];
    const rejected = [];
    const unclassified = [];
    for (const rel of all) {
        const reject = REJECT.find(r => r.test(rel));
        if (reject) { rejected.push({ path: rel, why: reject.label }); continue; }
        const ship = SHIP.find(r => r.test(rel));
        if (ship) { shipped.push(rel); continue; }
        unclassified.push(rel);
    }
    return { all, shipped, rejected, unclassified };
}

// ---------------------------------------------------------------- import closure

// The only host modules a shipped module may use. Anything else is either a dependency the archive does
// not carry or a capability a local module must not have.
export const ALLOWED_NODE = new Set([
    'node:fs', 'node:path', 'node:zlib', 'node:readline', 'node:url', 'node:util',
    'node:buffer', 'node:assert', 'node:os', 'node:crypto', 'node:stream',
]);

// Three specifier forms, matched independently. A single alternation with `[\s\S]*?` between `import`
// and `from` can run past a bare side-effect import to the next `from` in the file and swallow it.
// Comments are prose: a module comment may legitimately name a path or a word that reads like an API.
const stripComments = text => text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// The lookbehind is not decoration: `['from', 'to']` in a table header is the word `from` followed by
// a quote, and without it the pair of quotes after it reads as a module specifier. A defect of the
// same shape would hit any string literal ending in a word this list matches.
const SPECIFIER_FORMS = [
    /(?<!['"])\bfrom\s*['"]([^'"]+)['"]/g,  // import x from 'y'  ·  export { x } from 'y'
    /(?:^|[\s;])import\s*['"]([^'"]+)['"]/g, // import 'y'
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,  // await import('y')
];

const specifiers = code => SPECIFIER_FORMS
    .flatMap(re => [...code.matchAll(re)].map(m => m[1]))
    .filter(Boolean);

// Every relative import from a shipped module resolves to another shipped file, and every bare import
// is an allowed host module. A shipped file importing an excluded helper is a broken archive.
export function importClosure(pluginDir, shipped) {
    const root = path.resolve(pluginDir);
    const inArchive = new Set(shipped);
    const findings = [];

    for (const rel of shipped.filter(p => p.endsWith('.mjs') && !isMcpRuntime(p))) {
        // Comments stripped: a comment naming a path is prose, not an import.
        const code = stripComments(fs.readFileSync(path.join(root, rel), 'utf8'));
        for (const spec of specifiers(code)) {
            if (spec.startsWith('.')) {
                const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
                if (!inArchive.has(target)) {
                    findings.push(`${rel} imports ${spec}, which is not in the archive`);
                }
            } else if (!ALLOWED_NODE.has(spec)) {
                findings.push(`${rel} imports ${spec}, which is not an allowed host module`);
            }
        }
    }
    return findings;
}

// ---------------------------------------------------------------- shipped content

// Forbidden path families, named rather than inferred from a leading slash — which is why an ordinary
// regex literal is not a finding and a path inside a Markdown code span is.
export const FORBIDDEN_PATHS = [
    /(?:^|[^A-Za-z0-9])\/(?:Users|home|sessions|opt|var|etc|root|mnt|tmp|private|Applications|Volumes|srv|usr\/local)\//,
    /(?:^|[^A-Za-z0-9])~\//,
    /\$\{?HOME\}?/,
    /\bfile:\/\//,
    /(?<![A-Za-z])[A-Za-z]:[\\/]/,
    // A UNC path is a host NAME followed by a share, not any doubled backslash: `\\x` in an escape
    // sequence being constructed is not a host path, and reading it as one is the third time this
    // family has fired on ordinary source. The rule names the shape it is looking for.
    /\\\\[A-Za-z][A-Za-z0-9_.-]*[\\/]/,
];

export const FORBIDDEN_ANY = [
    { label: 'a page-API name', re: /\b(?:searchApi|resultsApi|queueApi|foldseekApi)\b/ },
    { label: 'a browser global', re: /\bwindow\.[A-Za-z]|\bdocument\.[A-Za-z]|\blocalStorage\b|\bsessionStorage\b|\bXMLHttpRequest\b/ },
    { label: 'an inline parameter block', re: /\b(?:const|let|var)\s+[A-Z][A-Z0-9_]{2,}\s*=\s*\{/ },
    { label: 'a decision id', re: /\bD\d{1,3}\b/ },
    { label: 'a document that does not ship', re: /mcp-migration|migration-map|skill-contracts|subcommand-policy-register|workflow-state-machine|release-allowlist|session-protocol|source-pins|pin-fragments|golden-evidence|parity-registry|reproducibility\.md|dispositions\.tsv|evidence\.md|context\.md|plan\.md|checklist\.md|handoffs\/|drafts\// },
    // The installable plugin must stand alone, so explicit paths to repository-only documents are rejected.
    { label: 'a repository-document reference', re: /(?:\.{1,2}\/)+docs\/|(?:^|[\s`'"(\[])docs\/[A-Za-z0-9_.-]+/m },
];

export const FORBIDDEN_CODE = [
    { label: 'a wait or an unbounded loop', re: /\bsetTimeout\b|\bsetInterval\b|while\s*\(\s*(?:true|1|!0)\s*\)|for\s*\(\s*;|\bdo\s*\{/ },
    { label: 'a shell-out', re: /\bchild_process\b|\bexecSync\b|\bspawnSync\b|\bexecFile|\bnew Function\s*\(/ },
    { label: 'a network call', re: /\bfetch\s*\(|\bXMLHttpRequest\b/ },
    { label: 'a process or environment read', re: /\bprocess\.env\b/ },
];

export function forbiddenContent(pluginDir, shipped) {
    const root = path.resolve(pluginDir);
    const findings = [];
    for (const rel of shipped) {
        // The vendored server is a pinned, hashed release artifact. Its network and environment access
        // are its purpose; tools/check-mcp-runtime.mjs enforces its closed file set and import closure.
        if (isMcpRuntime(rel)) continue;
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        for (const re of FORBIDDEN_PATHS) {
            if (re.test(text)) findings.push(`${rel} carries a host-specific path (${re.source.slice(0, 34)}…)`);
        }
        for (const { label, re } of FORBIDDEN_ANY) {
            if (re.test(text)) findings.push(`${rel} carries ${label}`);
        }
        if (rel.endsWith('.mjs') && !isMcpLauncher(rel)) {
            const code = stripComments(text);
            for (const { label, re } of FORBIDDEN_CODE) {
                if (re.test(code)) findings.push(`${rel} carries ${label}`);
            }
        }
    }
    return findings;
}

// ---------------------------------------------------------------- the whole contract

export function checkBoundary(pluginDir) {
    const { shipped, rejected, unclassified } = classify(pluginDir);
    const findings = [];
    for (const rel of unclassified) {
        findings.push(`${rel} is neither shipped nor explicitly rejected — classify it, do not filter at zip time`);
    }
    findings.push(...importClosure(pluginDir, shipped));
    findings.push(...forbiddenContent(pluginDir, shipped));
    return { shipped, rejected, unclassified, findings };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
    const dir = process.argv[2] ?? 'plugin';
    const { shipped, rejected, findings } = checkBoundary(dir);
    for (const f of findings) console.error(`boundary: ${f}`);
    if (findings.length === 0) {
        console.log(`${shipped.length} shipped, ${rejected.length} rejected`);
        for (const s of shipped) console.log(`   ${s}`);
    }
    process.exit(findings.length === 0 ? 0 : 1);
}
