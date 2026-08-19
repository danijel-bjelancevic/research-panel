import { describe, expect, it } from 'vitest';
import { groundingCounts, groundingSummary, renderGroundingMd, sortClaims } from '../src/grounding.js';
import type { GroundedClaim, GroundingRecord } from '../src/types.js';

function claim(overrides: Partial<GroundedClaim> = {}): GroundedClaim {
  return {
    id: 'c1',
    text: 'The EU gold retail market grew in 2025',
    importance: 'Demand assumption rests on it',
    verdict: 'supported',
    note: 'Industry reports confirm growth.',
    sources: [{ url: 'https://example.com/report', title: 'Market report' }],
    ...overrides,
  };
}

describe('groundingCounts', () => {
  it('counts every verdict with all keys present', () => {
    const counts = groundingCounts([
      claim({ verdict: 'supported' }),
      claim({ verdict: 'contested' }),
      claim({ verdict: 'supported' }),
    ]);
    expect(counts).toEqual({ supported: 2, contested: 1, unverified: 0 });
  });
});

describe('groundingSummary', () => {
  it('reports counts', () => {
    const summary = groundingSummary([claim(), claim({ id: 'c2', verdict: 'unverified' })]);
    expect(summary).toContain('2 load-bearing claim(s)');
    expect(summary).toContain('1 supported');
    expect(summary).toContain('1 unverified');
  });

  it('names contested claims explicitly', () => {
    const summary = groundingSummary([claim({ verdict: 'contested', text: 'Competitor X charges $99' })]);
    expect(summary).toContain('Contested: "Competitor X charges $99"');
  });

  it('stays quiet about contested claims when there are none', () => {
    expect(groundingSummary([claim()])).not.toContain('Contested:');
  });
});

describe('sortClaims', () => {
  it('puts contested first, then unverified, then supported', () => {
    const sorted = sortClaims([
      claim({ id: 'c1', verdict: 'supported' }),
      claim({ id: 'c2', verdict: 'unverified' }),
      claim({ id: 'c3', verdict: 'contested' }),
    ]);
    expect(sorted.map((c) => c.verdict)).toEqual(['contested', 'unverified', 'supported']);
  });

  it('orders numerically by id within a verdict and does not mutate input', () => {
    const input = [
      claim({ id: 'c10', verdict: 'supported' }),
      claim({ id: 'c2', verdict: 'supported' }),
    ];
    const sorted = sortClaims(input);
    expect(sorted.map((c) => c.id)).toEqual(['c2', 'c10']);
    expect(input.map((c) => c.id)).toEqual(['c10', 'c2']);
  });
});

describe('renderGroundingMd', () => {
  const record: GroundingRecord = {
    claims: [
      claim({ id: 'c1', verdict: 'supported' }),
      claim({
        id: 'c2',
        verdict: 'contested',
        text: 'No competitor offers this',
        note: 'Two competitors launched in 2026.',
        sources: [],
      }),
    ],
    summary: 'Fact-check of 2 load-bearing claim(s): 1 supported, 1 contested, 0 unverified.',
  };

  it('renders the summary and a table with contested claims first', () => {
    const md = renderGroundingMd(record);
    expect(md).toContain('## Grounding: do the facts hold?');
    expect(md).toContain(record.summary);
    expect(md.indexOf('No competitor offers this')).toBeLessThan(md.indexOf('EU gold retail market'));
    expect(md).toContain('**CONTESTED**');
  });

  it('links sources and marks missing ones', () => {
    const md = renderGroundingMd(record);
    expect(md).toContain('[Market report](https://example.com/report)');
    expect(md).toContain('(none found)');
  });
});
