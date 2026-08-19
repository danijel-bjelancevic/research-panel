import type { Idea } from './types.js';
import type { BoardCard } from './events.js';
import type { IdeaOut, ModeratorMergeOut, MoveOut } from './schemas.js';

const MIN_ACTIVE_IDEAS = 2;

export function ideasFromDivergence(seatId: string, out: IdeaOut[]): Idea[] {
  return out.map((idea, i) => ({
    id: `${seatId}-${i + 1}`,
    seatId,
    status: 'active' as const,
    title: idea.title,
    one_liner: idea.one_liner,
    description: idea.description,
    why_now: idea.why_now,
    risks: idea.risks,
    evidence: idea.evidence,
    revisionNotes: [],
  }));
}

export function activeIdeas(ideas: Idea[]): Idea[] {
  return ideas.filter((i) => i.status === 'active');
}

export function findIdea(ideas: Idea[], id: string): Idea | undefined {
  return ideas.find((i) => i.id === id);
}

/** Compact board snapshot for the UI event stream. */
export function boardCards(ideas: Idea[]): BoardCard[] {
  return ideas.map((idea) => {
    const card: BoardCard = {
      id: idea.id,
      seatId: idea.seatId,
      title: idea.title,
      one_liner: idea.one_liner,
      status: idea.status,
    };
    if (idea.statusReason) card.statusReason = idea.statusReason;
    return card;
  });
}

/**
 * Apply a seat's own move (defend / revise / abandon) to the board, in place.
 * Seats may only revise or abandon ideas they originated. Returns warnings for
 * anything that had to be ignored.
 */
export function applyMove(ideas: Idea[], seatId: string, move: MoveOut): string[] {
  const warnings: string[] = [];
  if (move.action === 'defend') return warnings;

  const idea = findIdea(ideas, move.idea_id);
  if (!idea || idea.status !== 'active') {
    warnings.push(`${seatId}: move "${move.action}" targeted unknown or inactive idea "${move.idea_id}" — ignored`);
    return warnings;
  }
  if (idea.seatId !== seatId) {
    warnings.push(`${seatId}: tried to ${move.action} another seat's idea "${move.idea_id}" — ignored`);
    return warnings;
  }

  if (move.action === 'abandon') {
    if (activeIdeas(ideas).length <= MIN_ACTIVE_IDEAS) {
      warnings.push(`${seatId}: abandon of "${move.idea_id}" ignored — board would fall below ${MIN_ACTIVE_IDEAS} ideas`);
      return warnings;
    }
    idea.status = 'dropped';
    idea.statusReason = `abandoned by ${seatId}: ${move.reasoning}`;
    return warnings;
  }

  // revise
  const rev = move.revision;
  if (!rev || Object.keys(rev).length === 0) {
    warnings.push(`${seatId}: revise of "${move.idea_id}" had no revision content — treated as defend`);
    return warnings;
  }
  if (rev.title) idea.title = rev.title;
  if (rev.one_liner) idea.one_liner = rev.one_liner;
  if (rev.description) idea.description = rev.description;
  if (rev.why_now) idea.why_now = rev.why_now;
  if (rev.risks) idea.risks = rev.risks;
  if (rev.evidence) idea.evidence = [...idea.evidence, ...rev.evidence];
  idea.revisionNotes.push(move.reasoning);
  return warnings;
}

/**
 * Apply the moderator's merge/drop decisions to the board, in place.
 * Invalid references are ignored with a warning; the board never falls below
 * MIN_ACTIVE_IDEAS active ideas.
 */
export function applyModeratorActions(ideas: Idea[], out: ModeratorMergeOut): string[] {
  const warnings: string[] = [];

  for (const merge of out.merges) {
    const keep = findIdea(ideas, merge.keep_id);
    if (!keep || keep.status !== 'active') {
      warnings.push(`moderator: merge keep_id "${merge.keep_id}" unknown or inactive — merge ignored`);
      continue;
    }
    for (const absorbId of merge.absorb_ids) {
      if (absorbId === merge.keep_id) continue;
      const absorb = findIdea(ideas, absorbId);
      if (!absorb || absorb.status !== 'active') {
        warnings.push(`moderator: merge absorb_id "${absorbId}" unknown or inactive — skipped`);
        continue;
      }
      if (activeIdeas(ideas).length <= MIN_ACTIVE_IDEAS) {
        warnings.push(`moderator: merge of "${absorbId}" skipped — board would fall below ${MIN_ACTIVE_IDEAS} ideas`);
        continue;
      }
      absorb.status = 'merged';
      absorb.statusReason = `merged into ${merge.keep_id}: ${merge.reason}`;
      keep.revisionNotes.push(`absorbed ${absorbId} (${absorb.title}): ${merge.reason}`);
    }
  }

  for (const drop of out.drops) {
    const idea = findIdea(ideas, drop.idea_id);
    if (!idea || idea.status !== 'active') {
      warnings.push(`moderator: drop of "${drop.idea_id}" unknown or inactive — ignored`);
      continue;
    }
    if (activeIdeas(ideas).length <= MIN_ACTIVE_IDEAS) {
      warnings.push(`moderator: drop of "${drop.idea_id}" skipped — board would fall below ${MIN_ACTIVE_IDEAS} ideas`);
      continue;
    }
    idea.status = 'dropped';
    idea.statusReason = `dropped by moderator: ${drop.reason}`;
  }

  return warnings;
}

export interface RenderBoardOpts {
  /** Truncate long descriptions to roughly this many characters (0 = no limit). */
  truncateDescription?: number;
}

export function renderBoardMarkdown(ideas: Idea[], opts: RenderBoardOpts = {}): string {
  const limit = opts.truncateDescription ?? 0;
  const lines: string[] = [];
  for (const idea of activeIdeas(ideas)) {
    lines.push(`### ${idea.id}: ${idea.title}`);
    lines.push(`*proposed by ${idea.seatId}* — ${idea.one_liner}`);
    lines.push('');
    const desc = limit > 0 && idea.description.length > limit ? `${idea.description.slice(0, limit)}…` : idea.description;
    lines.push(desc);
    lines.push('');
    lines.push(`**Why now:** ${idea.why_now}`);
    if (idea.risks.length > 0) {
      lines.push(`**Known risks:** ${idea.risks.join(' · ')}`);
    }
    if (idea.evidence.length > 0) {
      lines.push('**Evidence:**');
      for (const ev of idea.evidence.slice(0, 8)) {
        lines.push(`- ${ev.claim}${ev.url ? ` (${ev.url})` : ''}`);
      }
    }
    if (idea.revisionNotes.length > 0) {
      lines.push(`**Revision history:** ${idea.revisionNotes.length} revision(s); latest: ${idea.revisionNotes.at(-1)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
