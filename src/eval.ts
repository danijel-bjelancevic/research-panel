import type { RubricItem } from './config.js';
import type { EvalJudging, EvalRecord } from './types.js';

/**
 * Pure logic for the eval harness: combining the two blinded judgings
 * (candidates swapped between them to expose position bias), weighted score
 * totals, and the eval.md rendering. Model calls live in eval-run.ts.
 */

const MARGIN_RANK: Record<EvalJudging['margin'], number> = {
  slim: 0,
  clear: 1,
  decisive: 2,
};

export interface CombinedOutcome {
  outcome: 'panel' | 'baseline' | 'tie' | 'split';
  margin?: EvalJudging['margin'];
}

/**
 * Combine two judgings made with swapped candidate order.
 * - Same winner in both: that winner, at the more cautious of the two margins.
 * - Both ties: a tie.
 * - One tie, one winner: that winner, but only at "slim" - half the evidence vanished.
 * - Opposite winners: "split" - the verdict followed the position, not the content.
 */
export function resolveOutcome(first: EvalJudging, second: EvalJudging): CombinedOutcome {
  const a = first.winner;
  const b = second.winner;
  if (a === b) {
    if (a === 'tie') return { outcome: 'tie' };
    const margin = MARGIN_RANK[first.margin] <= MARGIN_RANK[second.margin] ? first.margin : second.margin;
    return { outcome: a, margin };
  }
  if (a === 'tie' || b === 'tie') {
    const winner = a === 'tie' ? b : a;
    return { outcome: winner as 'panel' | 'baseline', margin: 'slim' };
  }
  return { outcome: 'split' };
}

/** Weighted total of one candidate's rubric scores, on the rubric's own scale. */
export function weightedTotal(values: Record<string, number>, rubric: RubricItem[]): number {
  let total = 0;
  for (const item of rubric) {
    const value = values[item.key];
    if (typeof value === 'number') total += value * item.weight;
  }
  return total;
}

function outcomeLine(record: EvalRecord): string {
  switch (record.outcome) {
    case 'panel':
      return `**The panel wins** (${record.margin ?? 'slim'} margin): both blinded judgings preferred the panel's dossier, or one did while the other saw a tie.`;
    case 'baseline':
      return `**The baseline wins** (${record.margin ?? 'slim'} margin): the single model's dossier beat the panel's in blinded judging. The debate did not pay for itself on this topic.`;
    case 'tie':
      return '**Tie**: both blinded judgings scored the dossiers as equals. On this topic the panel added cost, not quality.';
    case 'split':
      return '**Inconclusive (position bias)**: the two judgings, with candidates swapped, disagreed about the winner. The verdict followed the position, not the content - trust neither.';
  }
}

function scoresTable(judging: EvalJudging, rubric: RubricItem[]): string {
  const lines: string[] = [];
  lines.push('| Rubric key | Weight | Panel | Baseline |');
  lines.push('|---|---|---|---|');
  for (const item of rubric) {
    const p = judging.scores.panel[item.key];
    const b = judging.scores.baseline[item.key];
    lines.push(`| ${item.key} | ${item.weight} | ${p ?? '-'} | ${b ?? '-'} |`);
  }
  lines.push(
    `| **weighted total** | | **${weightedTotal(judging.scores.panel, rubric).toFixed(1)}** | **${weightedTotal(
      judging.scores.baseline,
      rubric,
    ).toFixed(1)}** |`,
  );
  return lines.join('\n');
}

export function renderEvalMd(record: EvalRecord, rubric: RubricItem[]): string {
  const lines: string[] = [];
  lines.push(`# Eval: panel vs. single-model baseline`);
  lines.push('');
  lines.push(`Topic: ${record.topic}`);
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push(`| Evaluated | ${record.createdAt} |`);
  lines.push(`| Baseline model | ${record.baselineModel} |`);
  lines.push(`| Judge model | ${record.judgeModel} |`);
  lines.push(`| Panel cost (full session) | $${record.panelCostUsd.toFixed(3)} |`);
  lines.push(`| Baseline cost (one dossier) | $${record.baselineCostUsd.toFixed(3)} |`);
  lines.push(`| Judging cost | $${record.judgeCostUsd.toFixed(3)} |`);
  lines.push('');
  lines.push('## Verdict');
  lines.push('');
  lines.push(outcomeLine(record));
  lines.push('');
  if (record.outcome === 'panel' || record.outcome === 'baseline') {
    const ratio = record.baselineCostUsd > 0 ? record.panelCostUsd / record.baselineCostUsd : Infinity;
    lines.push(
      `Cost context: the panel spent ${Number.isFinite(ratio) ? `${ratio.toFixed(1)}x` : 'far'} more than the baseline to produce its dossier. Whether the quality difference is worth that multiple is the owner's call - this eval only establishes the direction.`,
    );
    lines.push('');
  }
  record.judgings.forEach((judging, i) => {
    lines.push(`## Judging ${i + 1} (${judging.order === 'panel-first' ? 'panel shown first' : 'baseline shown first'})`);
    lines.push('');
    lines.push(`Winner: **${judging.winner}** (${judging.margin})`);
    lines.push('');
    lines.push(scoresTable(judging, rubric));
    lines.push('');
    lines.push(`> ${judging.rationale}`);
    lines.push('');
  });
  lines.push('## How to read this honestly');
  lines.push('');
  lines.push('- **n = 1.** One topic, one baseline, one judge. This measures direction on this brief, not a general law.');
  lines.push(
    '- **Blinding is best-effort.** Candidates are labeled A and B and the judge is instructed to ignore provenance cues, but a dossier that mentions debate or dissent can still reveal itself.',
  );
  lines.push(
    '- **The judge has priors.** If the judge model shares a family with a panel seat or wrote the synthesis, self-preference is possible. Prefer a judge from a family that did not participate.',
  );
  lines.push(
    '- **Position bias is checked, not eliminated.** The two judgings swap candidate order; a split verdict means the judging cannot be trusted on this pair.',
  );
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## The baseline dossier (for reference)');
  lines.push('');
  lines.push(record.baselineDossier);
  lines.push('');
  return lines.join('\n');
}
