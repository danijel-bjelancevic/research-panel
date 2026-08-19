import type { RubricItem } from './config.js';
import type { SeatVote } from './types.js';

export interface LeaderboardEntry {
  ideaId: string;
  /** Rubric-weighted 0–10 score, averaged across the seats that scored it. */
  weightedScore: number;
  firstPlaceVotes: number;
}

export interface ConvergenceResult {
  converged: boolean;
  winnerId?: string;
  /** ideaId -> number of seats ranking it first */
  firstPlaceCounts: Record<string, number>;
}

/** Rubric-weighted score of one seat's score card for one idea. */
function weightedSeatScore(values: Record<string, number>, rubric: RubricItem[]): number | null {
  let sum = 0;
  let weightSum = 0;
  for (const item of rubric) {
    const value = values[item.key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      sum += value * item.weight;
      weightSum += item.weight;
    }
  }
  if (weightSum === 0) return null;
  return sum / weightSum;
}

export function computeLeaderboard(
  votes: SeatVote[],
  rubric: RubricItem[],
  activeIdeaIds: string[],
): LeaderboardEntry[] {
  const activeSet = new Set(activeIdeaIds);
  const perIdea = new Map<string, { scores: number[]; firstPlace: number }>();
  for (const id of activeIdeaIds) perIdea.set(id, { scores: [], firstPlace: 0 });

  for (const vote of votes) {
    for (const score of vote.scores) {
      if (!activeSet.has(score.ideaId)) continue;
      const seatScore = weightedSeatScore(score.values, rubric);
      if (seatScore !== null) perIdea.get(score.ideaId)?.scores.push(seatScore);
    }
    const top = vote.rankings.find((id) => activeSet.has(id));
    if (top) {
      const entry = perIdea.get(top);
      if (entry) entry.firstPlace += 1;
    }
  }

  const entries: LeaderboardEntry[] = [];
  for (const [ideaId, data] of perIdea) {
    const weightedScore =
      data.scores.length > 0 ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length : 0;
    entries.push({ ideaId, weightedScore, firstPlaceVotes: data.firstPlace });
  }
  entries.sort(
    (a, b) => b.firstPlaceVotes - a.firstPlaceVotes || b.weightedScore - a.weightedScore || a.ideaId.localeCompare(b.ideaId),
  );
  return entries;
}

/**
 * The panel has converged when at least `agreeSeats` seats rank the same idea
 * first (counting only ideas still on the board).
 */
export function checkConvergence(
  votes: SeatVote[],
  agreeSeats: number,
  activeIdeaIds: string[],
): ConvergenceResult {
  const activeSet = new Set(activeIdeaIds);
  const counts: Record<string, number> = {};
  for (const vote of votes) {
    const top = vote.rankings.find((id) => activeSet.has(id));
    if (top) counts[top] = (counts[top] ?? 0) + 1;
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [ideaId, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = ideaId;
      bestCount = count;
    }
  }
  if (best !== undefined && bestCount >= agreeSeats) {
    return { converged: true, winnerId: best, firstPlaceCounts: counts };
  }
  return { converged: false, firstPlaceCounts: counts };
}
