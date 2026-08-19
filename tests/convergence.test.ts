import { describe, expect, it } from 'vitest';
import { checkConvergence, computeLeaderboard } from '../src/convergence.js';
import type { RubricItem } from '../src/config.js';
import type { SeatVote } from '../src/types.js';

const rubric: RubricItem[] = [
  { key: 'feasibility', label: 'f', weight: 1 },
  { key: 'demand', label: 'd', weight: 3 },
];

function vote(seatId: string, rankings: string[], scores: SeatVote['scores'] = []): SeatVote {
  return { seatId, rankings, scores, rationale: 'r' };
}

describe('checkConvergence', () => {
  it('converges when two of three seats agree on #1', () => {
    const votes = [vote('a', ['x-1']), vote('b', ['x-1']), vote('c', ['y-2'])];
    const result = checkConvergence(votes, 2, ['x-1', 'y-2']);
    expect(result.converged).toBe(true);
    expect(result.winnerId).toBe('x-1');
  });

  it('does not converge when all seats disagree', () => {
    const votes = [vote('a', ['x-1']), vote('b', ['y-2']), vote('c', ['z-3'])];
    const result = checkConvergence(votes, 2, ['x-1', 'y-2', 'z-3']);
    expect(result.converged).toBe(false);
    expect(result.winnerId).toBeUndefined();
  });

  it('ignores rankings for ideas no longer on the board', () => {
    // Both seats ranked a dropped idea first; their #2 becomes the effective top pick.
    const votes = [vote('a', ['dead-1', 'x-1']), vote('b', ['dead-1', 'x-1']), vote('c', ['y-2'])];
    const result = checkConvergence(votes, 2, ['x-1', 'y-2']);
    expect(result.converged).toBe(true);
    expect(result.winnerId).toBe('x-1');
  });

  it('respects a stricter agreeSeats threshold', () => {
    const votes = [vote('a', ['x-1']), vote('b', ['x-1']), vote('c', ['y-2'])];
    const result = checkConvergence(votes, 3, ['x-1', 'y-2']);
    expect(result.converged).toBe(false);
  });
});

describe('computeLeaderboard', () => {
  it('applies rubric weights to scores', () => {
    const votes = [
      vote('a', ['x-1'], [{ ideaId: 'x-1', values: { feasibility: 10, demand: 2 } }]),
    ];
    const [entry] = computeLeaderboard(votes, rubric, ['x-1']);
    // (10*1 + 2*3) / 4 = 4
    expect(entry?.weightedScore).toBeCloseTo(4);
  });

  it('averages scores across seats and counts first-place votes', () => {
    const votes = [
      vote('a', ['x-1'], [
        { ideaId: 'x-1', values: { feasibility: 8, demand: 8 } },
        { ideaId: 'y-2', values: { feasibility: 4, demand: 4 } },
      ]),
      vote('b', ['x-1'], [
        { ideaId: 'x-1', values: { feasibility: 6, demand: 6 } },
        { ideaId: 'y-2', values: { feasibility: 9, demand: 9 } },
      ]),
    ];
    const board = computeLeaderboard(votes, rubric, ['x-1', 'y-2']);
    expect(board[0]?.ideaId).toBe('x-1');
    expect(board[0]?.firstPlaceVotes).toBe(2);
    expect(board[0]?.weightedScore).toBeCloseTo(7);
    expect(board[1]?.weightedScore).toBeCloseTo(6.5);
  });

  it('ranks by first-place votes before weighted score', () => {
    const votes = [
      vote('a', ['x-1'], [
        { ideaId: 'x-1', values: { feasibility: 5, demand: 5 } },
        { ideaId: 'y-2', values: { feasibility: 9, demand: 9 } },
      ]),
      vote('b', ['x-1'], [
        { ideaId: 'x-1', values: { feasibility: 5, demand: 5 } },
        { ideaId: 'y-2', values: { feasibility: 9, demand: 9 } },
      ]),
    ];
    const board = computeLeaderboard(votes, rubric, ['x-1', 'y-2']);
    expect(board[0]?.ideaId).toBe('x-1');
  });

  it('ignores rubric keys not in the config', () => {
    const votes = [
      vote('a', ['x-1'], [{ ideaId: 'x-1', values: { feasibility: 10, invented_key: 0 } }]),
    ];
    const [entry] = computeLeaderboard(votes, rubric, ['x-1']);
    expect(entry?.weightedScore).toBeCloseTo(10);
  });
});
