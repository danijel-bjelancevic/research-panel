import { createInterface } from 'node:readline/promises';
import { CostTracker, BudgetExceededError } from './cost.js';
import { log } from './log.js';
import type { OpenRouterClient } from './openrouter.js';
import type { SessionState } from './types.js';
import { activeIdeas, boardCards, findIdea, renderBoardMarkdown } from './board.js';
import { checkConvergence, computeLeaderboard } from './convergence.js';
import type { EventLog } from './events.js';
import type { CheckpointBridge } from './ui/server.js';
import {
  runBrief,
  runDebateRound,
  runDivergence,
  runPersonas,
  runRedTeam,
  runSignoff,
  runSynthesis,
  runVote,
  type PhaseCtx,
} from './phases.js';
import { appendTranscript, saveState, type SessionPaths } from './session.js';
import { writeDossier } from './report.js';
import { writeHtmlReport } from './report-html.js';

export class UserQuitError extends Error {
  constructor() {
    super('paused by the owner at a checkpoint');
    this.name = 'UserQuitError';
  }
}

export interface EngineOpts {
  client: OpenRouterClient;
  paths: SessionPaths;
  state: SessionState;
  assumeYes: boolean;
  events: EventLog;
  /** When set, the checkpoint is answered from the browser UI instead of the terminal. */
  bridge?: CheckpointBridge;
}

export async function runEngine(opts: EngineOpts): Promise<SessionState> {
  const { client, paths, state, events } = opts;
  const config = state.configSnapshot;
  const tracker = new CostTracker(config.maxCostUsd, state.costUsd);
  const ctx: PhaseCtx = {
    client,
    state,
    tracker,
    transcript: (chunk) => appendTranscript(paths, chunk),
    events,
  };
  const save = (): void => {
    state.costUsd = tracker.spentUsd;
    saveState(paths, state);
  };

  try {
    while (state.nextPhase !== 'done') {
      switch (state.nextPhase) {
        case 'brief':
          await runBrief(ctx);
          state.nextPhase = 'divergence';
          break;
        case 'divergence':
          await runDivergence(ctx);
          // Personas are designed after divergence so the moderator can aim the
          // lenses at the actual board; sessions from the older ordering that
          // already have personas skip straight to the checkpoint.
          state.nextPhase = state.personas.length > 0 ? 'checkpoint' : 'personas';
          break;
        case 'personas':
          await runPersonas(ctx);
          // Older sessions could reach this phase before divergence ran.
          state.nextPhase = state.ideas.length > 0 ? 'checkpoint' : 'divergence';
          break;
        case 'checkpoint':
          await runCheckpoint(opts, save);
          state.nextPhase = 'debate';
          state.nextRound = 1;
          break;
        case 'debate':
          await debateStep(ctx);
          break;
        case 'synthesis':
          await runSynthesis(ctx);
          state.nextPhase = config.redTeam.enabled ? 'redteam' : 'signoff';
          break;
        case 'redteam':
          await runRedTeam(ctx);
          state.nextPhase = 'signoff';
          break;
        case 'signoff':
          await runSignoff(ctx);
          state.finishedAt = new Date().toISOString();
          state.nextPhase = 'done';
          save();
          writeDossier(paths, state);
          writeHtmlReport(paths, state, events.all());
          events.emit({ type: 'done' });
          break;
      }
      save();
      events.emit({ type: 'cost', spentUsd: tracker.spentUsd, limitUsd: tracker.limit });
      if (tracker.shouldWarn()) {
        const warning = `spend has crossed 80% of the $${tracker.limit.toFixed(2)} cost limit`;
        log.warn(warning);
        events.emit({ type: 'warning', text: warning });
      }
      if (state.nextPhase !== 'done') log.cost(tracker.spentUsd, tracker.limit);
    }
  } catch (err) {
    save();
    writeHtmlReport(paths, state, events.all());
    if (err instanceof UserQuitError) {
      events.emit({ type: 'paused', reason: 'paused by the owner at a checkpoint' });
    } else if (err instanceof BudgetExceededError) {
      events.emit({ type: 'error', text: err.message });
    } else {
      events.emit({
        type: 'error',
        text: `${err instanceof Error ? err.message : String(err)} — the session was saved and can be resumed from the terminal.`,
      });
    }
    throw err;
  }
  return state;
}

async function debateStep(ctx: PhaseCtx): Promise<void> {
  const { state } = ctx;
  const config = state.configSnapshot;
  const round = state.nextRound;

  if (round > config.rounds.max) {
    // Only reachable via resume edge cases; make sure votes exist, then decide.
    if (!lastVotes(state)) await runVote(ctx, config.rounds.max);
    pickWinnerByCap(ctx);
    state.nextPhase = 'synthesis';
    return;
  }

  await runDebateRound(ctx, round);

  if (round >= config.rounds.min) {
    const votes = await runVote(ctx, round);
    const activeIds = activeIdeas(state.ideas).map((i) => i.id);
    const result = checkConvergence(votes, config.convergence.agreeSeats, activeIds);
    if (result.converged && result.winnerId) {
      state.winnerId = result.winnerId;
      state.convergedAtRound = round;
      const idea = findIdea(state.ideas, result.winnerId);
      log.success(
        `panel converged on ${result.winnerId}${idea ? ` (“${idea.title}”)` : ''} after round ${round}`,
      );
      const winnerEvent: { type: 'winner'; ideaId: string; converged: boolean; round: number; title?: string } = {
        type: 'winner',
        ideaId: result.winnerId,
        converged: true,
        round,
      };
      if (idea) winnerEvent.title = idea.title;
      ctx.events.emit(winnerEvent);
      state.nextPhase = 'synthesis';
      return;
    }
    log.info('no convergence yet — seats still disagree on the winner');
    if (round === config.rounds.max) {
      pickWinnerByCap(ctx);
      state.nextPhase = 'synthesis';
      return;
    }
  }
  state.nextRound = round + 1;
}

function lastVotes(state: SessionState) {
  return [...state.rounds].reverse().find((r) => r.votes && r.votes.length > 0)?.votes;
}

function pickWinnerByCap(ctx: PhaseCtx): void {
  const { state } = ctx;
  const votes = lastVotes(state);
  if (!votes || votes.length === 0) {
    throw new Error('round cap reached but no votes were recorded — cannot select a winner');
  }
  const activeIds = activeIdeas(state.ideas).map((i) => i.id);
  const leaderboard = computeLeaderboard(votes, state.configSnapshot.rubric, activeIds);
  const top = leaderboard[0];
  if (!top) throw new Error('round cap reached but the leaderboard is empty — cannot select a winner');
  state.winnerId = top.ideaId;
  state.forcedByCap = true;
  log.warn(
    `round cap reached without convergence — selecting the leaderboard leader ${top.ideaId} ` +
      `(score ${top.weightedScore.toFixed(2)}, ${top.firstPlaceVotes} first-place vote(s))`,
  );
  const idea = findIdea(state.ideas, top.ideaId);
  const winnerEvent: { type: 'winner'; ideaId: string; converged: boolean; title?: string } = {
    type: 'winner',
    ideaId: top.ideaId,
    converged: false,
  };
  if (idea) winnerEvent.title = idea.title;
  ctx.events.emit(winnerEvent);
}

function ownerDropIdeas(state: SessionState, ids: string[], events: EventLog): void {
  for (const id of ids) {
    const idea = findIdea(state.ideas, id);
    if (!idea || idea.status !== 'active') {
      log.warn(`unknown or inactive idea "${id}"`);
      continue;
    }
    if (activeIdeas(state.ideas).length <= 2) {
      log.warn('cannot drop below 2 active ideas');
      events.emit({ type: 'warning', text: `cannot drop "${id}" — the board must keep at least 2 active ideas` });
      break;
    }
    idea.status = 'dropped';
    idea.statusReason = 'dropped by the owner at the checkpoint';
    log.info(`dropped ${id}: ${idea.title}`);
    events.emit({ type: 'message', actor: 'owner', kind: 'owner', markdown: `Dropped **${id} — ${idea.title}**.` });
  }
  events.emit({ type: 'board', ideas: boardCards(state.ideas) });
}

function ownerAddSteer(state: SessionState, note: string, events: EventLog): void {
  state.steerNotes.push(note);
  log.info('steering note recorded — the panel will treat it as binding');
  events.emit({ type: 'message', actor: 'owner', kind: 'owner', markdown: `Steering note (binding): ${note}` });
}

async function runCheckpoint(opts: EngineOpts, save: () => void): Promise<void> {
  const { state, events, bridge } = opts;
  log.phase('Checkpoint · human steering');
  if (state.personas.length > 0) {
    log.plain('Panel personas:');
    for (const p of state.personas) {
      log.plain(`  - ${p.seatId}${p.source === 'auto' ? ' (auto)' : ''}: ${p.text}`);
    }
    log.plain('');
  }
  log.plain(renderBoardMarkdown(state.ideas, { truncateDescription: 500 }));

  if (opts.assumeYes || (!bridge && !process.stdin.isTTY)) {
    log.info('non-interactive run — checkpoint skipped, debate starts with the full board');
    return;
  }

  events.emit({ type: 'checkpoint' });

  if (bridge) {
    log.info('checkpoint open in the browser — drop ideas, steer, or continue from there');
    for (;;) {
      const action = await bridge.waitForAction();
      switch (action.kind) {
        case 'continue':
          events.emit({ type: 'checkpoint_done' });
          return;
        case 'quit':
          throw new UserQuitError();
        case 'drop':
          ownerDropIdeas(state, action.ids, events);
          save();
          break;
        case 'steer':
          ownerAddSteer(state, action.note, events);
          save();
          break;
      }
    }
  }

  log.plain('Review the board before the debate starts.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (
        await rl.question('\n[Enter] continue · drop <id[,id]> · steer <note> · quit > ')
      ).trim();
      if (answer === '') break;
      if (answer === 'quit') throw new UserQuitError();
      if (answer.startsWith('drop ')) {
        const ids = answer
          .slice(5)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        ownerDropIdeas(state, ids, events);
        save();
      } else if (answer.startsWith('steer ')) {
        const note = answer.slice(6).trim();
        if (note) {
          ownerAddSteer(state, note, events);
          save();
        }
      } else {
        log.warn('unrecognized command — use: drop <id>, steer <note>, quit, or press Enter');
      }
    }
  } finally {
    rl.close();
  }
  events.emit({ type: 'checkpoint_done' });
}
