import type { GroundedClaim, GroundingRecord } from './types.js';

/**
 * Pure logic for the grounding gate: verdict ordering, the mechanical
 * summary, and the markdown renderings used in the transcript, the red-team
 * and sign-off prompts, and the dossier. Model calls live in phases.ts.
 */

const VERDICT_WEIGHT: Record<GroundedClaim['verdict'], number> = {
  contested: 0,
  unverified: 1,
  supported: 2,
};

/** Counts per verdict, always with all three keys present. */
export function groundingCounts(claims: GroundedClaim[]): Record<GroundedClaim['verdict'], number> {
  const counts = { supported: 0, contested: 0, unverified: 0 };
  for (const c of claims) counts[c.verdict] += 1;
  return counts;
}

/**
 * Mechanical, model-free summary line. Names the contested claims because
 * those are the ones a reader must not miss.
 */
export function groundingSummary(claims: GroundedClaim[]): string {
  const counts = groundingCounts(claims);
  const parts = [
    `${counts.supported} supported`,
    `${counts.contested} contested`,
    `${counts.unverified} unverified`,
  ];
  let line = `Fact-check of ${claims.length} load-bearing claim(s): ${parts.join(', ')}.`;
  const contested = claims.filter((c) => c.verdict === 'contested');
  if (contested.length > 0) {
    line += ` Contested: ${contested.map((c) => `"${c.text}"`).join('; ')}.`;
  }
  return line;
}

/**
 * Order claims for presentation: contested first, then unverified, then
 * supported; stable within a verdict by claim id so output is deterministic.
 */
export function sortClaims(claims: GroundedClaim[]): GroundedClaim[] {
  return [...claims].sort((a, b) => {
    const weight = VERDICT_WEIGHT[a.verdict] - VERDICT_WEIGHT[b.verdict];
    if (weight !== 0) return weight;
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });
}

function verdictLabel(verdict: GroundedClaim['verdict']): string {
  switch (verdict) {
    case 'supported':
      return 'SUPPORTED';
    case 'contested':
      return '**CONTESTED**';
    case 'unverified':
      return 'unverified';
  }
}

/** Grounding section rendered into the dossier, the transcript and downstream prompts. */
export function renderGroundingMd(record: GroundingRecord): string {
  const lines: string[] = [];
  lines.push('## Grounding: do the facts hold?');
  lines.push('');
  lines.push(record.summary);
  lines.push('');
  lines.push('| # | Claim | Verdict | What the evidence shows | Sources |');
  lines.push('|---|---|---|---|---|');
  sortClaims(record.claims).forEach((claim, i) => {
    const sources =
      claim.sources.length > 0
        ? claim.sources.map((s, j) => `[${s.title ?? `source ${j + 1}`}](${s.url})`).join(' · ')
        : '(none found)';
    lines.push(`| ${i + 1} | ${claim.text} | ${verdictLabel(claim.verdict)} | ${claim.note} | ${sources} |`);
  });
  lines.push('');
  return lines.join('\n');
}
