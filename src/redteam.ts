import type { RedTeamFailure, RedTeamRecord, RedTeamRisk } from './types.js';

/**
 * Pure logic for the red-team pre-mortem phase: risk ordering and the
 * markdown renderings used in the transcript, the sign-off prompt and the
 * dossier. Model calls live in phases.ts; everything here is unit-testable.
 */

const LIKELIHOOD_SCORE: Record<RedTeamRisk['likelihood'], number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const SEVERITY_SCORE: Record<RedTeamRisk['severity'], number> = {
  annoying: 1,
  serious: 2,
  fatal: 3,
};

/** Combined priority of a risk: likelihood x severity, 1..9. */
export function riskScore(risk: Pick<RedTeamRisk, 'likelihood' | 'severity'>): number {
  return LIKELIHOOD_SCORE[risk.likelihood] * SEVERITY_SCORE[risk.severity];
}

/**
 * Order risks for presentation: highest priority first, ties broken by how
 * many seats raised the risk, then alphabetically so output is deterministic.
 */
export function sortRisks(risks: RedTeamRisk[]): RedTeamRisk[] {
  return [...risks].sort((a, b) => {
    const score = riskScore(b) - riskScore(a);
    if (score !== 0) return score;
    const support = b.raisedBy.length - a.raisedBy.length;
    if (support !== 0) return support;
    return a.title.localeCompare(b.title);
  });
}

/** Digest of every seat's failure stories, fed to the moderator for consolidation. */
export function failuresDigestMd(failures: RedTeamFailure[]): string {
  if (failures.length === 0) return '(no failure stories were produced)';
  return failures
    .map(
      (f) =>
        `- [${f.seatId}] **${f.title}** (likelihood: ${f.likelihood}, severity: ${f.severity})\n` +
        `  Story: ${f.story}\n` +
        `  Earliest warning sign: ${f.warningSign}\n` +
        `  Mitigation: ${f.mitigation}`,
    )
    .join('\n');
}

/** Pre-mortem section rendered into the dossier, the transcript and the sign-off prompt. */
export function renderRedTeamMd(record: RedTeamRecord): string {
  const lines: string[] = [];
  lines.push('## Pre-mortem: how this fails');
  lines.push('');
  lines.push(record.summary);
  lines.push('');
  lines.push('| # | Risk | Likelihood | Severity | Earliest warning sign | Mitigation | Raised by |');
  lines.push('|---|---|---|---|---|---|---|');
  sortRisks(record.topRisks).forEach((risk, i) => {
    lines.push(
      `| ${i + 1} | ${risk.title} | ${risk.likelihood} | ${risk.severity} | ${risk.warningSign} | ${risk.mitigation} | ${
        risk.raisedBy.join(', ') || 'moderator'
      } |`,
    );
  });
  lines.push('');
  if (record.proceedConditions.length > 0) {
    lines.push('**Proceed only if:**');
    lines.push('');
    for (const c of record.proceedConditions) lines.push(`- ${c}`);
    lines.push('');
  }
  return lines.join('\n');
}
