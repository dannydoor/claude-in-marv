// The subcommand table.

import { survey } from '../hit/survey.mjs';
import { table } from '../hit/table.mjs';
import { coverage } from '../hit/coverage.mjs';
import { phyletic } from '../hit/phyletic.mjs';
import { memberSelection } from '../hit/member-selection.mjs';
import { qc } from '../msa/qc.mjs';
import { memberAudit } from '../msa/member-audit.mjs';
import { blocks } from '../msa/blocks.mjs';
import { columnRanking } from '../msa/column-ranking.mjs';
import { compactness } from '../msa/compactness.mjs';
import { columnComposition } from '../msa/column-composition.mjs';
import { columnResidues } from '../msa/column-residues.mjs';
import { authorNumbering } from '../msa/author-numbering.mjs';
import { resultMetrics } from '../folddisco/result-metrics.mjs';
import { residueRetention } from '../folddisco/residue-retention.mjs';
import { shortlist } from '../folddisco/shortlist.mjs';
import { residueDistances } from '../folddisco/residue-distances.mjs';
import { reach } from '../workflow/reach.mjs';

const entries = [
    survey, table, coverage, phyletic, memberSelection,
    qc, memberAudit, blocks, columnRanking, compactness,
    columnComposition, columnResidues, authorNumbering,
    resultMetrics, residueRetention, shortlist, residueDistances,
    reach,
];

export const SUBCOMMANDS = Object.freeze(Object.fromEntries(entries.map(spec => [spec.name, spec])));

export const GROUPS = Object.freeze([...new Set(entries.map(spec => spec.name.split('/')[0]))].sort());

export const namesIn = group => Object.keys(SUBCOMMANDS)
    .filter(name => name.startsWith(`${group}/`))
    .map(name => name.slice(group.length + 1))
    .sort();

export const lookup = (group, subcommand) => SUBCOMMANDS[`${group}/${subcommand}`] ?? null;
