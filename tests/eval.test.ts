import { describe, expect, it } from 'vitest';
import { renderEvalMd, resolveOutcome, weightedTotal } from '../src/eval.js';
import type { RubricItem } from '../src/config.js';
import type { EvalJudging, EvalRecord } from '../src/types.js';

function judging(overrides: Partial<EvalJudging> = {}): EvalJudging {
  return {
    order: 'panel-first',
    winner: 'panel',
    margin: 'clear',
    rationale: 'The panel dossier engaged the objections more honestly.',
    scores: {
      panel: { demand: 8, feasibility: 7 },
      baseline: { demand: 6, feasibility: 7 },
    },
    ...overrides,
  };
}

describe('resolveOutcome', () => {
  it('agrees on a winner at the more cautious margin', () => {
    const result = resolveOutcome(
      judging({ margin: 'decisive' }),
      judging({ order: 'baseline-first', margin: 'slim' }),
    );
    expect(result).toEqual({ outcome: 'panel', margin: 'slim' });
  });

  it('returns a tie when both judgings tie', () => {
    const result = resolveOutcome(
      judging({ winner: 'tie' }),
      judging({ order: 'baseline-first', winner: 'tie' }),
    );
    expect(result).toEqual({ outcome: 'tie' });
  });

  it('downgrades to slim when one judging ties and the other picks a side', () => {
    const result = resolveOutcome(
      judging({ winner: 'tie' }),
      judging({ order: 'baseline-first', winner: 'baseline', margin: 'decisive' }),
    );
    expect(result).toEqual({ outcome: 'baseline', margin: 'slim' });
  });

  it('declares a split when the verdict follows the position', () => {
    const result = resolveOutcome(
      judging({ winner: 'panel' }),
      judging({ order: 'baseline-first', winner: 'baseline' }),
    );
    expect(result).toEqual({ outcome: 'split' });
  });
});

describe('weightedTotal', () => {
  const rubric: RubricItem[] = [
    { key: 'demand', label: 'Demand', weight: 1.5 },
    { key: 'feasibility', label: 'Feasibility', weight: 1 },
  ];

  it('sums values weighted by the rubric', () => {
    expect(weightedTotal({ demand: 8, feasibility: 6 }, rubric)).toBeCloseTo(18);
  });

  it('ignores missing keys instead of producing NaN', () => {
    expect(weightedTotal({ demand: 8 }, rubric)).toBeCloseTo(12);
  });
});

describe('renderEvalMd', () => {
  const rubric: RubricItem[] = [
    { key: 'demand', label: 'Demand', weight: 1.5 },
    { key: 'feasibility', label: 'Feasibility', weight: 1 },
  ];
  const record: EvalRecord = {
    createdAt: '2026-08-19T12:00:00.000Z',
    topic: 'test topic',
    baselineModel: 'vendor/solo-model',
    judgeModel: 'vendor/judge-model',
    panelCostUsd: 6.5,
    baselineCostUsd: 0.4,
    judgeCostUsd: 0.2,
    outcome: 'panel',
    margin: 'clear',
    judgings: [judging(), judging({ order: 'baseline-first' })],
    baselineDossier: '## Recommendation\nBuild the thing.',
  };

  it('renders the verdict, both judgings, and weighted totals', () => {
    const md = renderEvalMd(record, rubric);
    expect(md).toContain('**The panel wins**');
    expect(md).toContain('Judging 1 (panel shown first)');
    expect(md).toContain('Judging 2 (baseline shown first)');
    expect(md).toContain('**19.0**');
    expect(md).toContain('**16.0**');
  });

  it('keeps the honesty section and the baseline dossier', () => {
    const md = renderEvalMd(record, rubric);
    expect(md).toContain('How to read this honestly');
    expect(md).toContain('n = 1');
    expect(md).toContain('Build the thing.');
  });

  it('calls out a split verdict as untrustworthy', () => {
    const md = renderEvalMd({ ...record, outcome: 'split' }, rubric);
    expect(md).toContain('position bias');
    expect(md).toContain('trust neither');
  });
});
