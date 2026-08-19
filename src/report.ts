import { writeFileSync } from 'node:fs';
import type { SessionPaths } from './session.js';
import type { SessionState } from './types.js';
import { activeIdeas, findIdea } from './board.js';
import { computeLeaderboard } from './convergence.js';

export function renderDossier(state: SessionState): string {
  const config = state.configSnapshot;
  const winner = state.winnerId ? findIdea(state.ideas, state.winnerId) : undefined;
  const lines: string[] = [];

  lines.push(`# Research dossier: ${state.topic}`);
  lines.push('');
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| Started | ${state.startedAt} |`);
  lines.push(`| Finished | ${state.finishedAt ?? '—'} |`);
  lines.push(`| Panel | ${config.seats.map((s) => `${s.id} (${s.model})`).join(', ')} |`);
  lines.push(`| Moderator | ${config.moderator.model} |`);
  lines.push(`| Debate rounds | ${state.rounds.length} |`);
  lines.push(
    `| Outcome | ${
      state.convergedAtRound
        ? `converged in round ${state.convergedAtRound}`
        : state.forcedByCap
          ? 'round cap reached — leaderboard leader selected'
          : '—'
    } |`,
  );
  lines.push(`| Winning idea | ${winner ? `${winner.id}: ${winner.title}` : '—'} |`);
  lines.push(`| Total cost | $${state.costUsd.toFixed(3)} |`);
  lines.push('');

  if (state.personas.length > 0) {
    lines.push('## The panel');
    lines.push('');
    for (const seat of config.seats) {
      const persona = state.personas.find((p) => p.seatId === seat.id);
      if (!persona) continue;
      lines.push(
        `- **${seat.id}** (\`${seat.model}\`) — ${persona.source === 'auto' ? '_persona designed by the moderator for this topic:_ ' : ''}${persona.text}`,
      );
    }
    lines.push('');
  }

  if (state.synthesis) {
    lines.push('---');
    lines.push('');
    lines.push(state.synthesis);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## Panel verdict');
  lines.push('');
  if (state.signoffs.length === 0) {
    lines.push('_No sign-offs recorded._');
  } else {
    for (const s of state.signoffs) {
      lines.push(`- **${s.seatId}** — ${s.verdict === 'sign' ? 'signs' : 'DISSENTS'}: ${s.statement}`);
    }
  }
  lines.push('');

  const lastVotes = [...state.rounds].reverse().find((r) => r.votes && r.votes.length > 0)?.votes;
  if (lastVotes && lastVotes.length > 0) {
    const leaderboard = computeLeaderboard(
      lastVotes,
      config.rubric,
      activeIdeas(state.ideas).map((i) => i.id),
    );
    lines.push('## Final leaderboard');
    lines.push('');
    lines.push('| # | Idea | Weighted score (0–10) | First-place votes |');
    lines.push('|---|---|---|---|');
    leaderboard.forEach((entry, i) => {
      const idea = findIdea(state.ideas, entry.ideaId);
      lines.push(
        `| ${i + 1} | ${entry.ideaId}: ${idea?.title ?? '?'} | ${entry.weightedScore.toFixed(2)} | ${entry.firstPlaceVotes} |`,
      );
    });
    lines.push('');
  }

  const graveyard = state.ideas.filter((i) => i.status !== 'active');
  if (graveyard.length > 0) {
    lines.push('## Idea graveyard');
    lines.push('');
    for (const idea of graveyard) {
      lines.push(`- **${idea.id}: ${idea.title}** — ${idea.statusReason ?? idea.status}`);
    }
    lines.push('');
  }

  if (state.rounds.length > 0) {
    lines.push('## Round summaries');
    lines.push('');
    for (const round of state.rounds) {
      lines.push(`- **Round ${round.round}:** ${round.roundSummary}`);
    }
    lines.push('');
  }

  if (state.steerNotes.length > 0) {
    lines.push('## Owner steering notes');
    lines.push('');
    for (const note of state.steerNotes) lines.push(`- ${note}`);
    lines.push('');
  }

  if (state.citations.length > 0) {
    lines.push('## Sources cited during research');
    lines.push('');
    for (const c of state.citations) {
      lines.push(`- ${c.title ? `[${c.title}](${c.url})` : c.url}`);
    }
    lines.push('');
  }

  if (state.warnings.length > 0) {
    lines.push('## Run warnings');
    lines.push('');
    for (const w of state.warnings) lines.push(`- ${w}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('_Full debate transcript: `transcript.md` in this directory. Machine-readable state: `state.json`._');
  lines.push('');
  return lines.join('\n');
}

export function writeDossier(paths: SessionPaths, state: SessionState): void {
  writeFileSync(paths.dossierPath, renderDossier(state), 'utf8');
}
