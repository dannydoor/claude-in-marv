import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const REFS = path.join(SKILLS, 'references');

const skillDirs = () => fs.readdirSync(SKILLS)
    .filter(name => name !== 'references' && fs.existsSync(path.join(SKILLS, name, 'SKILL.md')));

function readSkill(name) {
    const text = fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8');
    const frontmatter = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    assert.ok(frontmatter, `${name}: missing frontmatter`);
    return { frontmatter: frontmatter[1], body: frontmatter[2] };
}

test('installed skills have valid identity, concise triggers and live reference links', () => {
    const names = new Set();
    for (const directory of skillDirs()) {
        const skill = readSkill(directory);
        const name = /^name:\s*(\S+)$/m.exec(skill.frontmatter)?.[1];
        const description = /^description:\s*(.+)$/m.exec(skill.frontmatter)?.[1];
        assert.equal(name, directory, `${directory}: name must match its directory`);
        assert.equal(names.has(name), false, `${directory}: duplicate skill name`);
        names.add(name);
        assert.match(description ?? '', /^Use (?:when|for)\b/, `${directory}: description needs a use condition`);
        assert.ok((description ?? '').split(/\s+/).length <= 24, `${directory}: description is too long`);

        const links = [...skill.body.matchAll(/\[[^\]]+\]\(\.\.\/references\/([a-z-]+\.md)#([a-z-]+)\)/g)];
        assert.ok(links.length > 0, `${directory}: no shared-reference link`);
        for (const [, file, heading] of links) {
            const target = path.join(REFS, file);
            assert.ok(fs.existsSync(target), `${directory}: missing ${file}`);
            assert.match(fs.readFileSync(target, 'utf8'), new RegExp(`^## ${heading}$`, 'm'),
                `${directory}: ${file} has no #${heading}`);
        }
    }
});

test('output contracts use reader-facing language', () => {
    for (const directory of skillDirs()) {
        const body = readSkill(directory).body;
        const output = /^## Output shapes\n([\s\S]*)$/m.exec(body)?.[1];
        assert.ok(output, `${directory}: missing output contract`);
        assert.match(output, /\.\.\/references\/reporting\.md#audience/,
            `${directory}: output contract must use the shared audience policy`);
        assert.doesNotMatch(output,
            /\b(?:artifact id|analysis version|structured code|server code|carrier intersection|match classes|qualifiers|provenance|lineage)\b/i,
            `${directory}: output contract exposes an implementation term`);
    }
});

test('analysis guidance names only portable entry points and staging mechanisms', () => {
    const all = [
        ...skillDirs().map(name => fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8')),
        ...fs.readdirSync(REFS).filter(name => name.endsWith('.md'))
            .map(name => fs.readFileSync(path.join(REFS, name), 'utf8')),
    ].join('\n');
    assert.match(all, /node \.\.\/\.\.\/analysis\/bin\/foldseek-analyze\.mjs/);
    assert.match(all, /device_stage_files/);
    assert.doesNotMatch(all, /\$\{CLAUDE_PLUGIN_ROOT\}\/analysis/);
    assert.ok(fs.existsSync(path.join(ROOT, 'plugin', 'analysis', 'bin', 'foldseek-analyze.mjs')));
});

test('every shared reference declares when it should be read', () => {
    const references = fs.readdirSync(REFS).filter(name => name.endsWith('.md'));
    assert.ok(references.length > 0);
    for (const file of references) {
        const text = fs.readFileSync(path.join(REFS, file), 'utf8');
        assert.match(text, /\*\*Read when:\*\*/, `${file}: missing read condition`);
    }
});

test('workflow guidance preserves explicit review and forwarding boundaries', () => {
    const reference = name => fs.readFileSync(path.join(REFS, name), 'utf8');
    const skill = name => readSkill(name).body;

    assert.match(reference('interpretation.md'), /small bounded TSV may be inspected in full/);
    assert.match(reference('interpretation.md'), /qLen.*dbLen.*qStartPos.*dbEndPos/);
    assert.match(reference('interpretation.md'), /structural maintenance, biological function, or both/);
    assert.match(reference('workflow-state.md'), /rejected.*absent or an empty array/);
    assert.match(reference('artifact-contract.md'), /occupiedColumns.*gaps/);
    assert.match(reference('artifact-contract.md'), /modelled sequence positions, not deposited author numbering/);

    assert.match(skill('foldmason-conserved-site'), /revisit the member set before changing the column criteria/);
    assert.match(skill('foldmason-motif-forwarding'), /selection's `name` to `send_to`/);
    assert.match(skill('server-operations'), /externally supplied motif or one with no alignment provenance/);
    assert.match(skill('structural-analysis-workflow'), /phyletic distribution or clade breadth/);
});
