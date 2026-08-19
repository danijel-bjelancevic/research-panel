import { describe, expect, it } from 'vitest';
import { failuresDigestMd, renderRedTeamMd, riskScore, sortRisks } from '../src/redteam.js';
import type { RedTeamFailure, RedTeamRecord, RedTeamRisk } from '../src/types.js';

function risk(overrides: Partial<RedTeamRisk> = {}): RedTeamRisk {
  return {
    title: 'Demand never materializes',
    likelihood: 'medium',
    severity: 'fatal',
    warningSign: 'Fewer than 5 discovery calls booked in month one',
    mitigation: 'Pre-sell before building',
    raisedBy: ['claude'],
    ...overrides,
  };
}

describe('riskScore', () => {
  it('multiplies likelihood by severity', () => {
    expect(riskScore({ likelihood: 'low', severity: 'annoying' })).toBe(1);
    expect(riskScore({ likelihood: 'high', severity: 'fatal' })).toBe(9);
    expect(riskScore({ likelihood: 'medium', severity: 'serious' })).toBe(4);
  });
});

describe('sortRisks', () => {
  it('orders by score descending', () => {
    const low = risk({ title: 'a', likelihood: 'low', severity: 'annoying' });
    const high = risk({ title: 'b', likelihood: 'high', severity: 'fatal' });
    const mid = risk({ title: 'c', likelihood: 'medium', severity: 'serious' });
    expect(sortRisks([low, mid, high]).map((r) => r.title)).toEqual(['b', 'c', 'a']);
  });

  it('breaks score ties by seat support, then title', () => {
    const solo = risk({ title: 'beta', raisedBy: ['gpt'] });
    const backed = risk({ title: 'zeta', raisedBy: ['claude', 'gemini'] });
    const alpha = risk({ title: 'alpha', raisedBy: ['kimi'] });
    expect(sortRisks([solo, backed, alpha]).map((r) => r.title)).toEqual(['zeta', 'alpha', 'beta']);
  });

  it('does not mutate its input', () => {
    const input = [risk({ title: 'x', likelihood: 'low' }), risk({ title: 'y', likelihood: 'high' })];
    const before = input.map((r) => r.title);
    sortRisks(input);
    expect(input.map((r) => r.title)).toEqual(before);
  });
});

describe('failuresDigestMd', () => {
  it('renders one block per failure with seat attribution', () => {
    const failures: RedTeamFailure[] = [
      {
        seatId: 'gpt',
        title: 'Churn spiral',
        story: 'Customers left after month two.',
        likelihood: 'high',
        severity: 'serious',
        warningSign: 'Second-month retention below 60%',
        mitigation: 'Onboarding calls for every account',
      },
    ];
    const md = failuresDigestMd(failures);
    expect(md).toContain('[gpt]');
    expect(md).toContain('Churn spiral');
    expect(md).toContain('Second-month retention below 60%');
  });

  it('handles the empty case explicitly', () => {
    expect(failuresDigestMd([])).toContain('no failure stories');
  });
});

describe('renderRedTeamMd', () => {
  const record: RedTeamRecord = {
    failures: [],
    topRisks: [
      risk({ title: 'Fatal one', likelihood: 'high', severity: 'fatal', raisedBy: ['claude', 'gpt'] }),
      risk({ title: 'Minor one', likelihood: 'low', severity: 'annoying', raisedBy: [] }),
    ],
    proceedConditions: ['Ship a validation experiment first'],
    summary: 'The panel is cautiously positive.',
  };

  it('renders the summary, a ranked table, and proceed conditions', () => {
    const md = renderRedTeamMd(record);
    expect(md).toContain('## Pre-mortem: how this fails');
    expect(md).toContain('The panel is cautiously positive.');
    expect(md.indexOf('Fatal one')).toBeLessThan(md.indexOf('Minor one'));
    expect(md).toContain('claude, gpt');
    expect(md).toContain('**Proceed only if:**');
    expect(md).toContain('- Ship a validation experiment first');
  });

  it('credits the moderator when no seat raised a risk', () => {
    const md = renderRedTeamMd(record);
    expect(md).toContain('| moderator |');
  });
});
