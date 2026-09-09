// Identifier normalisation is a pure function of one string.

export const RULE_ID = 'reach-norm-1';

const FORMAT_SUFFIX = /\.(?:pdb|cif|ent|gz)$/i;
const CHAIN_TOKEN = /[_.]([A-Za-z0-9]{1,4})$/;
const VERSION_SUFFIX = /(?:-model_v\d+|-F\d+|_v\d+)$/i;

// A named version suffix wins over the overlapping generic chain spelling.
const chainSplit = base => {
    const match = CHAIN_TOKEN.exec(base);
    if (match === null) return null;
    if (VERSION_SUFFIX.test(base.slice(match.index))) return null;
    return { chain: match[1], base: base.slice(0, match.index) };
};

export function normalise(identifier, { splitChain = true } = {}) {
    const original = typeof identifier === 'string' ? identifier.trim() : '';
    let base = original;
    while (FORMAT_SUFFIX.test(base)) base = base.replace(FORMAT_SUFFIX, '');
    let chain = null;
    if (splitChain) {
        const split = chainSplit(base);
        if (split !== null) {
            chain = split.chain;
            base = split.base;
        }
    }
    const stripped = [];
    let version = VERSION_SUFFIX.exec(base);
    while (version !== null) {
        stripped.unshift(base.slice(version.index));
        base = base.slice(0, version.index);
        version = VERSION_SUFFIX.exec(base);
    }
    return { original, base: base.toUpperCase(), chain, stripped };
}

// Retain both readings so ambiguous matches remain excluded.
export const readings = identifier => ({
    split: normalise(identifier),
    whole: normalise(identifier, { splitChain: false }),
});

// Restrict entry-level keys to monomer-fold versus motif comparisons.
export function entryLevelEligible({ foldTool, motifTool }) {
    if (foldTool !== 'foldseek') {
        return { eligible: false, reason: `the fold side is a ${foldTool ?? 'unknown'} ticket, and the entry-level key is monomer-only: on a multimer, an interface or any cross-chain claim the chain and the assembly are the subject, not a qualifier` };
    }
    if (motifTool !== 'folddisco') {
        return { eligible: false, reason: `the motif side is a ${motifTool ?? 'unknown'} ticket, and the entry-level key is defined for a monomer fold search against a motif search` };
    }
    return { eligible: true, reason: null };
}

const PDB_LEAD = /^[0-9][A-Za-z0-9]{3}(?![A-Za-z0-9])/;
const PDB_SHAPE = /^(?<accession>[0-9][A-Za-z0-9]{3})(?:-assembly(?<assembly>\d+))?(?:[._](?<chain>[A-Za-z0-9]{1,4}))?(?:-(?<copy>\d+))?$/;

// Parse documented PDB100 forms and bare FoldDisco accessions.
export function pdbEntryReading(identifier) {
    const original = typeof identifier === 'string' ? identifier.trim() : '';
    let body = original;
    while (FORMAT_SUFFIX.test(body)) body = body.replace(FORMAT_SUFFIX, '');
    const bare = {
        original, base: normalise(identifier).base,
        accession: null, assembly: null, chain: null, copy: null,
    };
    if (!PDB_LEAD.test(body)) {
        return { ...bare, isPdb: false, entryLevel: false, unparsed: false, reason: null };
    }
    const shape = PDB_SHAPE.exec(body);
    if (shape === null) {
        return {
            ...bare, isPdb: true, entryLevel: false, unparsed: true,
            reason: 'leads with a PDB accession but matches no documented pdb100 shape, so it was not reduced to an entry key',
        };
    }
    const { accession, assembly, chain, copy } = shape.groups;
    const count = token => (token === undefined ? null : Number(token));
    return {
        ...bare,
        isPdb: true,
        entryLevel: true,
        unparsed: false,
        accession: accession.toUpperCase(),
        assembly: count(assembly),
        chain: chain ?? null,
        copy: count(copy),
        reason: null,
    };
}
