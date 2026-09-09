// completeness is one top-level object decided on the largest database, never per-database.
export function saturation(summary) {
    const c = summary?.completeness ?? {};
    return {
        saturated: c.saturated === true,
        complete: c.complete ?? null,
        rowCap: c.rowCap ?? null,
        basis: summary?.tool === 'folddisco' ? 'proven' : 'inferred',
    };
}
