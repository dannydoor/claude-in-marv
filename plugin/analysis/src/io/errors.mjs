// Structured errors stop a run; warnings do not.

export const ERROR_CODES = Object.freeze([
    'ARTIFACT_NOT_READY',
    'MANIFEST_UNREADABLE',
    'ARTIFACT_ID_MISMATCH',
    'DATABASE_ROSTER_INVALID',
    'REQUIRED_ROLE_MISSING',
    'ROLE_DB_INDEX_MISMATCH',
    'FILE_SIZE_MISMATCH',
    'PATH_OUTSIDE_ROOT',
    'MALFORMED_ROW',
    'PARSE_FAILED',
    'INVALID_ANALYSIS',
]);

const CODES = new Set(ERROR_CODES);

export class AnalysisError extends Error {
    constructor(code, facts = {}) {
        if (!CODES.has(code)) throw new Error(`not an analysis error code: ${code}`);
        super(code);
        this.name = 'AnalysisError';
        this.code = code;
        this.facts = facts;
    }

    // Serialize only the code and observed facts.
    toJSON() {
        return { error: { code: this.code, facts: this.facts } };
    }
}

export const fail = (code, facts) => {
    throw new AnalysisError(code, facts);
};
