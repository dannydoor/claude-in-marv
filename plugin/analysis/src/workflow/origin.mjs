// Establish exact query origin from recorded ancestry or an explicit assertion.

export const ORIGIN_ASSERTION = 'origin';
export const DB_ASSERTION = 'db-equivalence';

// Parse `--assert <type>:<payload>` once and keep assertion types independent.
export function parseAssertion(raw) {
    const text = String(raw).trim();
    const colon = text.indexOf(':');
    if (colon <= 0) return { type: null, payload: text, valid: false, reason: 'no <type>:<payload>' };
    const type = text.slice(0, colon);
    const payload = text.slice(colon + 1);
    if (type === ORIGIN_ASSERTION) return parseOrigin(payload);
    if (type === DB_ASSERTION) return parseEquivalence(payload);
    return { type: null, payload, valid: false, reason: 'unknown assertion type' };
}

const PAIR = /^([^/\s]+)\/(\d+)$/;

// Require both complete origin pairs in an assertion.
function parseOrigin(payload) {
    if (payload === 'session') {
        return { type: ORIGIN_ASSERTION, mode: 'session', valid: true };
    }
    const sides = {};
    for (const part of payload.split(',')) {
        const equals = part.indexOf('=');
        if (equals <= 0) continue;
        const side = part.slice(0, equals).trim();
        const match = PAIR.exec(part.slice(equals + 1).trim());
        if ((side !== 'left' && side !== 'right') || match === null) continue;
        sides[side] = { ticket: match[1], queryIdx: Number(match[2]) };
    }
    if (sides.left === undefined || sides.right === undefined) {
        return {
            type: ORIGIN_ASSERTION, valid: false,
            reason: 'both sides must name a complete ticket and query index',
        };
    }
    // An origin assertion states that both sides are one query.
    if (sides.left.ticket !== sides.right.ticket || sides.left.queryIdx !== sides.right.queryIdx) {
        return {
            type: ORIGIN_ASSERTION, valid: false, left: sides.left, right: sides.right,
            reason: 'the two sides name different query origins, which is not a common origin',
        };
    }
    return { type: ORIGIN_ASSERTION, mode: 'explicit', valid: true, left: sides.left, right: sides.right };
}

// Database equivalence never establishes query origin.
function parseEquivalence(payload) {
    const equals = payload.indexOf('=');
    const left = equals > 0 ? payload.slice(0, equals).trim() : '';
    const right = equals > 0 ? payload.slice(equals + 1).trim() : '';
    if (left === '' || right === '') {
        return { type: DB_ASSERTION, valid: false, reason: 'both database paths must be named' };
    }
    return { type: DB_ASSERTION, valid: true, left, right };
}

// One hop of recorded ancestry, which is all a manifest carries.
export function originOf(manifest) {
    const derived = manifest?.derivedFrom;
    if (derived !== null && derived !== undefined) {
        if (typeof derived === 'object' && !Array.isArray(derived)
            && typeof derived.ticket === 'string' && derived.ticket !== ''
            && Number.isInteger(derived.queryIdx)) {
            return { ticket: derived.ticket, queryIdx: derived.queryIdx, via: 'derivedFrom', resolved: true };
        }
        return { ticket: null, queryIdx: null, via: null, resolved: false };
    }
    const ticket = manifest?.state?.ticket ?? null;
    const queryIdx = manifest?.state?.queryIdx;
    if (typeof ticket === 'string' && ticket !== '' && Number.isInteger(queryIdx)) {
        return { ticket, queryIdx, via: 'direct-submission', resolved: true };
    }
    return { ticket: null, queryIdx: null, via: null, resolved: false };
}

export const sameOrigin = (left, right) =>
    left.resolved && right.resolved && left.ticket === right.ticket && left.queryIdx === right.queryIdx;

// ---------------------------------------------------------------- the explicit chain

export const CHAIN_RULE = 'derivedFrom-chain';

// Classify the ancestry shape recorded by one manifest.
export function hopOf(manifest) {
    const derived = manifest?.derivedFrom;
    if (derived === null || derived === undefined) {
        const ticket = manifest?.state?.ticket ?? null;
        const queryIdx = manifest?.state?.queryIdx;
        if (typeof ticket === 'string' && ticket !== '' && Number.isInteger(queryIdx)) {
            return { kind: 'direct', ticket, queryIdx };
        }
        return { kind: 'unreadable', reason: 'no derivedFrom and no complete state ticket and query index' };
    }
    if (typeof derived !== 'object' || Array.isArray(derived)) {
        return { kind: 'unreadable', reason: 'derivedFrom is not an object' };
    }
    const ticket = typeof derived.ticket === 'string' && derived.ticket !== '' ? derived.ticket : null;
    if (ticket === null) return { kind: 'unreadable', reason: 'derivedFrom names no ticket' };
    // A ticket and query index identify the origin outright.
    if (Number.isInteger(derived.queryIdx)) return { kind: 'complete', ticket, queryIdx: derived.queryIdx };
    // A ticket without queryIdx identifies only the parent run.
    return {
        kind: 'partial',
        ticket,
        origin: typeof derived.origin === 'string' ? derived.origin : null,
        entryName: typeof derived.entryName === 'string' && derived.entryName !== '' ? derived.entryName : null,
    };
}

// Resolve the forwarded query from the intermediate alignment roster.
const stemOf = name => String(name).replace(/\.[^./]+$/, '');
const ENCODED_MULTIMER = '-_-_-_';
const QUERY_ENTRY = /^query(?:_[^/]+)?$/;

// Recognise server-owned query names without coupling ancestry to the multimer suffix grammar.
const isQueryEntry = name => {
    const stem = stemOf(name);
    return QUERY_ENTRY.test(stem)
        || (stem.startsWith(`query${ENCODED_MULTIMER}`)
            && stem.length > `query${ENCODED_MULTIMER}`.length
            && !stem.includes('/'));
};

export function queryEntryOf(manifest) {
    const entries = manifest?.derivedFrom?.entries;
    if (!Array.isArray(entries)) return { name: null, reason: 'the intermediate records no entry roster' };
    const matches = entries.filter(isQueryEntry);
    if (matches.length === 0) {
        // `includeQuery: false`, or a roster built from hits alone.
        return { name: null, reason: 'the intermediate carries no forwarded query entry' };
    }
    if (matches.length > 1) {
        return { name: null, reason: 'more than one roster file could be the query entry', candidates: matches.sort() };
    }
    return { name: stemOf(matches[0]), reason: null };
}

// Index `--via` artifacts by ticket and refuse duplicate claims.
export function intermediatePool(supplied) {
    const byTicket = new Map();
    const clashes = [];
    for (const entry of supplied) {
        const ticket = entry.manifest?.state?.ticket ?? null;
        if (typeof ticket !== 'string' || ticket === '') {
            clashes.push({ reason: 'this intermediate carries no state ticket', artifactId: entry.artifactId });
            continue;
        }
        if (byTicket.has(ticket)) {
            clashes.push({
                reason: 'two intermediates name one ticket', ticket,
                artifactIds: [byTicket.get(ticket).artifactId, entry.artifactId].sort(),
            });
            continue;
        }
        byTicket.set(ticket, entry);
    }
    return { byTicket, clashes };
}

// Walk supplied ancestry to an exact ticket and query index.
export function resolveChain(manifest, pool, { sessionAssertion = false } = {}) {
    const route = [];
    const consumed = [];
    const sessionAssertedEntries = [];
    const seen = new Set();
    let current = manifest;
    // Bound the walk by the supplied intermediate pool.
    const ceiling = pool.byTicket.size + 1;
    for (let step = 0; step < ceiling; step += 1) {
        const hop = hopOf(current);
        const at = current?.state?.ticket ?? null;
        if (at !== null) {
            if (seen.has(at)) {
                return { resolved: false, problem: { kind: 'cyclic', ticket: at, route }, route, consumed };
            }
            seen.add(at);
        }
        if (hop.kind === 'unreadable') {
            return { resolved: false, problem: { kind: 'unreadable', reason: hop.reason, route }, route, consumed };
        }
        if (hop.kind === 'direct' || hop.kind === 'complete') {
            route.push({ ticket: at, tool: current?.state?.tool ?? null, hop: hop.kind });
            return {
                resolved: true,
                origin: {
                    ticket: hop.ticket,
                    queryIdx: hop.queryIdx,
                    via: hop.kind === 'direct' ? 'direct-submission' : 'derivedFrom',
                    resolved: true,
                },
                hops: route.length,
                route,
                consumed,
                sessionAssertedEntries,
            };
        }
        // A partial hop requires its supplied parent artifact.
        const parent = pool.byTicket.get(hop.ticket) ?? null;
        if (parent === null) {
            return {
                resolved: false,
                problem: { kind: 'missing', ticket: hop.ticket, origin: hop.origin, route },
                route,
                consumed,
            };
        }
        // Inherit an alignment hop only from its query entry.
        if (hop.origin === 'fm-entry') {
            const tool = parent.manifest?.state?.tool ?? null;
            if (tool !== 'foldmason') {
                return {
                    resolved: false,
                    problem: { kind: 'mismatched', ticket: hop.ticket, expectedTool: 'foldmason', tool, route },
                    route,
                    consumed,
                };
            }
            const queryEntry = queryEntryOf(parent.manifest);
            if (queryEntry.name === null) {
                const asserted = sessionAssertion
                    ? sessionEntryOf(parent.manifest, hop.entryName, queryEntry)
                    : null;
                if (asserted !== null) {
                    sessionAssertedEntries.push({ ticket: hop.ticket, entryName: asserted });
                } else {
                    return {
                        resolved: false,
                        problem: {
                            kind: 'unidentified-entry', ticket: hop.ticket, reason: queryEntry.reason,
                            candidates: queryEntry.candidates ?? [], entryName: hop.entryName, route,
                        },
                        route,
                        consumed,
                        sessionAssertedEntries,
                    };
                }
            } else if (hop.entryName === null || hop.entryName !== queryEntry.name) {
                return {
                    resolved: false,
                    problem: {
                        kind: 'unidentified-entry', ticket: hop.ticket,
                        reason: 'the entry the motif was read off is not the alignment\'s query entry',
                        entryName: hop.entryName, queryEntry: queryEntry.name, route,
                    },
                    route,
                    consumed,
                    sessionAssertedEntries,
                };
            }
        }
        route.push({
            ticket: at,
            tool: current?.state?.tool ?? null,
            hop: hop.kind,
            origin: hop.origin,
            entryName: hop.entryName,
            inheritedFrom: hop.ticket,
        });
        consumed.push(parent.artifactId);
        current = parent.manifest;
    }
    // Exhausting the input-bounded walk is reported as a cycle.
    return {
        resolved: false,
        problem: { kind: 'cyclic', ticket: null, route },
        route,
        consumed,
        sessionAssertedEntries,
    };
}

// A session assertion may identify one roster entry only when the roster lacks a canonical query name.
function sessionEntryOf(manifest, entryName, queryEntry) {
    if (queryEntry.reason !== 'the intermediate carries no forwarded query entry') return null;
    if (typeof entryName !== 'string' || entryName === '') return null;
    const entries = manifest?.derivedFrom?.entries;
    if (!Array.isArray(entries)) return null;
    const matches = entries.filter(entry => stemOf(entry) === entryName);
    return matches.length === 1 ? entryName : null;
}
