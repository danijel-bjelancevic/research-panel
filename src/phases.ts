import type { z } from 'zod';
import { log } from './log.js';
import { parseJsonWith } from './json.js';
import { BudgetExceededError, type CostTracker } from './cost.js';
import type { OpenRouterClient, WebSearchOpts } from './openrouter.js';
import type { Config, SeatConfig } from './config.js';
import type {
  Citation,
  CritiqueRecord,
  MergeProposalRecord,
  MoveRecord,
  SeatVote,
  SessionState,
} from './types.js';
import * as prompts from './prompts.js';
import {
  ClaimsOutSchema,
  DebateOutSchema,
  DivergenceOutSchema,
  ModeratorMergeOutSchema,
  PersonasOutSchema,
  RedTeamModeratorOutSchema,
  RedTeamOutSchema,
  SignoffOutSchema,
  VerifyOutSchema,
  VoteOutSchema,
} from './schemas.js';
import { failuresDigestMd, renderRedTeamMd } from './redteam.js';
import { groundingSummary, renderGroundingMd } from './grounding.js';
import type { GroundedClaim, RedTeamFailure } from './types.js';
import { personaFor, resolvePersonas, seatsNeedingPersona } from './personas.js';
import {
  activeIdeas,
  applyModeratorActions,
  applyMove,
  boardCards,
  findIdea,
  ideasFromDivergence,
  renderBoardMarkdown,
} from './board.js';
import { computeLeaderboard } from './convergence.js';
import type { EventLog } from './events.js';
import type { DebateOut, IdeaOut, VoteOut } from './schemas.js';

export interface PhaseCtx {
  client: OpenRouterClient;
  state: SessionState;
  tracker: CostTracker;
  transcript: (chunk: string) => void;
  events: EventLog;
}

function emitWarnings(ctx: PhaseCtx, warnings: string[]): void {
  for (const w of warnings) ctx.events.emit({ type: 'warning', text: w });
}

function emitBoard(ctx: PhaseCtx): void {
  ctx.events.emit({ type: 'board', ideas: boardCards(ctx.state.ideas) });
}

function ideasMd(ideas: IdeaOut[]): string {
  return ideas
    .map((idea) => {
      const parts = [
        `**${idea.title}** — ${idea.one_liner}`,
        idea.description,
        `_Why now:_ ${idea.why_now}`,
      ];
      if (idea.risks.length > 0) parts.push(`_Risks:_ ${idea.risks.join(' · ')}`);
      if (idea.evidence.length > 0) {
        parts.push(
          idea.evidence
            .map((e) => `- ${e.claim}${e.url ? ` ([source](${e.url}))` : ''}`)
            .join('\n'),
        );
      }
      return parts.join('\n\n');
    })
    .join('\n\n---\n\n');
}

function debateMd(out: DebateOut): string {
  const parts: string[] = ['**Critiques**'];
  parts.push(
    out.critiques
      .map((c) => {
        const links = c.evidence.filter((e) => e.url).map((e) => `  - [${e.claim}](${e.url})`);
        return `- **${c.idea_id}** — ${c.objection}${links.length > 0 ? `\n${links.join('\n')}` : ''}`;
      })
      .join('\n'),
  );
  parts.push(`**My move · ${out.own_move.action} ${out.own_move.idea_id}**\n\n${out.own_move.reasoning}`);
  if (out.merge_proposal) {
    parts.push(`**Merge proposal:** ${out.merge_proposal.idea_ids.join(' + ')} — ${out.merge_proposal.rationale}`);
  }
  return parts.join('\n\n');
}

function voteMd(out: VoteOut): string {
  return `**Ranking:** ${out.rankings.join(' → ')}\n\n${out.rationale}`;
}

function cfg(ctx: PhaseCtx): Config {
  return ctx.state.configSnapshot;
}

function searchOpts(ctx: PhaseCtx): WebSearchOpts | null {
  const ws = cfg(ctx).webSearch;
  return ws.enabled ? { engine: ws.engine, maxResults: ws.maxResults } : null;
}

function addCitations(state: SessionState, citations: Citation[]): void {
  const seen = new Set(state.citations.map((c) => c.url));
  for (const c of citations) {
    if (!seen.has(c.url)) {
      seen.add(c.url);
      state.citations.push(c);
    }
  }
}

async function chatText(
  ctx: PhaseCtx,
  model: string,
  system: string,
  user: string,
  search: WebSearchOpts | null,
): Promise<string> {
  ctx.tracker.ensure();
  const res = await ctx.client.chat({ model, system, user, webSearch: search });
  ctx.tracker.add(res.costUsd);
  addCitations(ctx.state, res.citations);
  return res.text;
}

async function chatJson<T>(
  ctx: PhaseCtx,
  label: string,
  model: string,
  system: string,
  user: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  search: WebSearchOpts | null,
): Promise<T> {
  ctx.tracker.ensure();
  const first = await ctx.client.chat({ model, system, user, webSearch: search });
  ctx.tracker.add(first.costUsd);
  addCitations(ctx.state, first.citations);
  const parsed = parseJsonWith(schema, first.text);
  if (parsed.success) return parsed.data;

  log.warn(`${label}: reply was not usable JSON — requesting a repair`);
  ctx.tracker.ensure();
  const repairUser =
    `${user}\n\n---\nYour previous reply could not be used. Problem: ${parsed.error}\n` +
    `Your previous reply (truncated):\n${first.text.slice(0, 4000)}\n\n` +
    `Reply again with ONLY the JSON object — no prose, no markdown fences.`;
  const second = await ctx.client.chat({ model, system, user: repairUser, webSearch: null });
  ctx.tracker.add(second.costUsd);
  const parsed2 = parseJsonWith(schema, second.text);
  if (parsed2.success) return parsed2.data;
  throw new Error(`${label}: unusable JSON after one repair attempt (${parsed2.error})`);
}

/**
 * Run one call per seat concurrently. Individual seat failures become
 * warnings; budget exhaustion aborts the run. Throws if fewer than `minOk`
 * seats succeed — a panel needs disagreement, which needs participants.
 */
async function perSeat<T>(
  ctx: PhaseCtx,
  phaseLabel: string,
  run: (seat: SeatConfig) => Promise<T>,
  minOk = 2,
): Promise<Array<{ seat: SeatConfig; result: T }>> {
  const seats = cfg(ctx).seats;
  const settled = await Promise.allSettled(
    seats.map(async (seat) => {
      log.seat(seat.id, `${phaseLabel}…`);
      ctx.events.emit({ type: 'seat_working', actor: seat.id, activity: phaseLabel });
      const result = await run(seat);
      log.seat(seat.id, `${phaseLabel} — done`);
      return { seat, result };
    }),
  );

  const ok: Array<{ seat: SeatConfig; result: T }> = [];
  let budgetError: BudgetExceededError | undefined;
  settled.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled') {
      ok.push(outcome.value);
      return;
    }
    if (outcome.reason instanceof BudgetExceededError) {
      budgetError = outcome.reason;
      return;
    }
    const msg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    const warning = `seat "${seats[i].id}" failed during ${phaseLabel}: ${msg}`;
    ctx.state.warnings.push(warning);
    log.warn(warning);
    ctx.events.emit({ type: 'warning', text: warning });
  });

  if (budgetError) throw budgetError;
  if (ok.length < minOk) {
    throw new Error(`only ${ok.length} seat(s) completed "${phaseLabel}" (need ${minOk}) — aborting the run`);
  }
  return ok;
}

export async function runBrief(ctx: PhaseCtx): Promise<void> {
  log.phase('Phase 1 · Research brief');
  ctx.events.emit({ type: 'phase', phase: 'brief', label: 'Research brief' });
  ctx.events.emit({ type: 'seat_working', actor: 'moderator', activity: 'writing the research brief' });
  log.moderator('expanding the topic into a research brief…');
  const config = cfg(ctx);
  const text = await chatText(
    ctx,
    config.moderator.model,
    prompts.moderatorSystem(),
    prompts.briefUser(ctx.state.topic, ctx.state.ownerNotes),
    searchOpts(ctx),
  );
  ctx.state.brief = text.trim();
  ctx.transcript(
    `# Research panel: ${ctx.state.topic}\n\n_Started ${ctx.state.startedAt}_\n\n## Research brief\n\n${ctx.state.brief}\n`,
  );
  ctx.events.emit({ type: 'message', actor: 'moderator', kind: 'brief', markdown: ctx.state.brief });
  log.moderator('brief ready');
}

export async function runPersonas(ctx: PhaseCtx): Promise<void> {
  log.phase('Phase 3 · Panel personas');
  ctx.events.emit({ type: 'phase', phase: 'personas', label: 'Panel personas' });
  const config = cfg(ctx);
  const needing = seatsNeedingPersona(config.seats);
  let generated: Array<{ seat_id: string; persona: string }> = [];
  if (needing.length > 0) {
    log.moderator(`designing ${needing.length} persona(s) to stress-test the board…`);
    ctx.events.emit({ type: 'seat_working', actor: 'moderator', activity: 'designing personas to stress-test the board' });
    const boardMd =
      activeIdeas(ctx.state.ideas).length > 0
        ? renderBoardMarkdown(ctx.state.ideas, { truncateDescription: 600 })
        : undefined;
    const out = await chatJson(
      ctx,
      'moderator/personas',
      config.moderator.model,
      prompts.moderatorSystem(),
      prompts.personasUser(ctx.state.brief ?? ctx.state.topic, needing.map((s) => s.id), boardMd),
      PersonasOutSchema,
      null,
    );
    generated = out.personas;
  } else {
    log.info('all seats have personas pinned in the config — nothing to design');
  }
  const { personas, warnings } = resolvePersonas(config.seats, generated);
  ctx.state.personas = personas;
  ctx.state.warnings.push(...warnings);
  warnings.forEach((w) => log.warn(w));
  emitWarnings(ctx, warnings);
  for (const p of personas) {
    log.seat(p.seatId, `${p.source === 'auto' ? '(auto) ' : '(pinned) '}${p.text}`);
    ctx.events.emit({
      type: 'message',
      actor: p.seatId,
      kind: 'persona',
      markdown: `_${p.source === 'auto' ? 'Persona designed by the moderator for this topic' : 'Persona pinned in the config'}._\n\n${p.text}`,
    });
  }
  ctx.transcript(
    `\n## Panel personas\n\n` +
      personas.map((p) => `- **${p.seatId}** ${p.source === 'auto' ? '(designed by the moderator)' : '(pinned in config)'}: ${p.text}`).join('\n') +
      '\n',
  );
}

export async function runDivergence(ctx: PhaseCtx): Promise<void> {
  log.phase('Phase 2 · Blind divergence (raw models, no personas)');
  ctx.events.emit({ type: 'phase', phase: 'divergence', label: 'Blind divergence' });
  const config = cfg(ctx);
  const brief = ctx.state.brief ?? ctx.state.topic;
  const results = await perSeat(ctx, 'proposing ideas', async (seat) => {
    const out = await chatJson(
      ctx,
      `${seat.id}/divergence`,
      seat.model,
      prompts.divergenceSystem(seat, config),
      prompts.divergenceUser(brief, config),
      DivergenceOutSchema,
      searchOpts(ctx),
    );
    ctx.events.emit({
      type: 'message',
      actor: seat.id,
      kind: 'ideas',
      markdown: ideasMd(out.ideas.slice(0, config.ideasPerSeat)),
    });
    return out;
  });
  for (const { seat, result } of results) {
    ctx.state.ideas.push(...ideasFromDivergence(seat.id, result.ideas.slice(0, config.ideasPerSeat)));
  }
  ctx.transcript(`\n## Divergence — independent proposals\n\n${renderBoardMarkdown(ctx.state.ideas)}\n`);
  emitBoard(ctx);
  log.info(`${activeIdeas(ctx.state.ideas).length} ideas on the board`);
}

export async function runDebateRound(ctx: PhaseCtx, round: number): Promise<void> {
  const config = cfg(ctx);
  log.phase(`Phase 4 · Debate — round ${round} of ${config.rounds.max}`);
  ctx.events.emit({ type: 'phase', phase: 'debate', label: `Debate · round ${round} of ${config.rounds.max}` });
  const results = await perSeat(ctx, `debating (round ${round})`, async (seat) => {
    const out = await chatJson(
      ctx,
      `${seat.id}/debate-${round}`,
      seat.model,
      prompts.panelSystem(seat, config, personaFor(ctx.state.personas, seat)),
      prompts.debateUser(ctx.state, seat, round),
      DebateOutSchema,
      searchOpts(ctx),
    );
    ctx.events.emit({ type: 'message', actor: seat.id, kind: 'debate', round, markdown: debateMd(out) });
    return out;
  });

  const critiques: CritiqueRecord[] = [];
  const moves: MoveRecord[] = [];
  const mergeProposals: MergeProposalRecord[] = [];
  for (const { seat, result } of results) {
    for (const c of result.critiques) {
      if (!findIdea(ctx.state.ideas, c.idea_id)) {
        const warning = `${seat.id}: critique of unknown idea "${c.idea_id}" ignored (round ${round})`;
        ctx.state.warnings.push(warning);
        ctx.events.emit({ type: 'warning', text: warning });
        continue;
      }
      critiques.push({ seatId: seat.id, ideaId: c.idea_id, objection: c.objection, evidence: c.evidence });
    }
    moves.push({
      seatId: seat.id,
      action: result.own_move.action,
      ideaId: result.own_move.idea_id,
      reasoning: result.own_move.reasoning,
    });
    if (result.merge_proposal) {
      mergeProposals.push({
        seatId: seat.id,
        ideaIds: result.merge_proposal.idea_ids,
        rationale: result.merge_proposal.rationale,
      });
    }
  }
  // Moves apply after all seats have answered, so every seat debated the same board.
  for (const { seat, result } of results) {
    const warnings = applyMove(ctx.state.ideas, seat.id, result.own_move);
    ctx.state.warnings.push(...warnings);
    warnings.forEach((w) => log.warn(w));
    emitWarnings(ctx, warnings);
  }

  log.moderator('tidying the board…');
  ctx.events.emit({ type: 'seat_working', actor: 'moderator', activity: `tidying the board after round ${round}` });
  const digests = {
    critiquesMd: critiques.map((c) => `- [${c.seatId} → ${c.ideaId}] ${c.objection}`).join('\n'),
    movesMd: moves.map((m) => `- [${m.seatId}] ${m.action} ${m.ideaId}: ${m.reasoning}`).join('\n'),
    mergeProposalsMd: mergeProposals
      .map((p) => `- [${p.seatId}] merge ${p.ideaIds.join(' + ')}: ${p.rationale}`)
      .join('\n'),
  };
  const modOut = await chatJson(
    ctx,
    `moderator/merge-${round}`,
    config.moderator.model,
    prompts.moderatorSystem(),
    prompts.moderatorMergeUser(ctx.state, round, digests),
    ModeratorMergeOutSchema,
    null,
  );
  const modWarnings = applyModeratorActions(ctx.state.ideas, modOut);
  ctx.state.warnings.push(...modWarnings);
  modWarnings.forEach((w) => log.warn(w));
  emitWarnings(ctx, modWarnings);
  ctx.events.emit({ type: 'message', actor: 'moderator', kind: 'round_summary', round, markdown: modOut.round_summary });
  emitBoard(ctx);

  ctx.state.rounds.push({
    round,
    critiques,
    moves,
    mergeProposals,
    roundSummary: modOut.round_summary,
    votes: null,
  });

  ctx.transcript(
    `\n## Debate round ${round}\n\n### Critiques\n${digests.critiquesMd || '(none)'}\n\n` +
      `### Moves\n${digests.movesMd || '(none)'}\n\n` +
      (digests.mergeProposalsMd ? `### Merge proposals\n${digests.mergeProposalsMd}\n\n` : '') +
      `### Moderator summary\n${modOut.round_summary}\n\n` +
      `### Board after round ${round}\n${renderBoardMarkdown(ctx.state.ideas, { truncateDescription: 400 })}\n`,
  );
  log.moderator(modOut.round_summary);
  log.info(`${activeIdeas(ctx.state.ideas).length} ideas remain active`);
}

export async function runVote(ctx: PhaseCtx, round: number): Promise<SeatVote[]> {
  const config = cfg(ctx);
  log.phase(`Vote · after round ${round}`);
  ctx.events.emit({ type: 'phase', phase: 'vote', label: `Vote · after round ${round}` });
  const activeIds = new Set(activeIdeas(ctx.state.ideas).map((i) => i.id));
  const results = await perSeat(ctx, 'voting', async (seat) => {
    const out = await chatJson(
      ctx,
      `${seat.id}/vote-${round}`,
      seat.model,
      prompts.panelSystem(seat, config, personaFor(ctx.state.personas, seat)),
      prompts.voteUser(ctx.state),
      VoteOutSchema,
      null,
    );
    ctx.events.emit({ type: 'message', actor: seat.id, kind: 'vote', round, markdown: voteMd(out) });
    return out;
  });

  const votes: SeatVote[] = results.map(({ seat, result }) => {
    const rankings = result.rankings.filter((id) => activeIds.has(id));
    if (rankings.length !== result.rankings.length) {
      ctx.state.warnings.push(`${seat.id}: vote referenced unknown idea ids — those entries were ignored`);
    }
    return {
      seatId: seat.id,
      rankings,
      scores: result.scores
        .filter((s) => activeIds.has(s.idea_id))
        .map((s) => ({ ideaId: s.idea_id, values: s.values })),
      rationale: result.rationale,
    };
  });

  const lastRound = ctx.state.rounds.at(-1);
  if (lastRound) lastRound.votes = votes;

  const leaderboard = computeLeaderboard(votes, config.rubric, [...activeIds]);
  ctx.events.emit({
    type: 'leaderboard',
    entries: leaderboard.map((entry) => ({
      ideaId: entry.ideaId,
      title: findIdea(ctx.state.ideas, entry.ideaId)?.title ?? entry.ideaId,
      weightedScore: entry.weightedScore,
      firstPlaceVotes: entry.firstPlaceVotes,
    })),
  });

  ctx.transcript(
    `\n### Votes after round ${round}\n` +
      votes.map((v) => `- **${v.seatId}** ranks: ${v.rankings.join(' > ') || '(none)'} — ${v.rationale}`).join('\n') +
      '\n',
  );
  for (const v of votes) log.seat(v.seatId, `ranks ${v.rankings.join(' > ') || '(no valid ranking)'}`);
  return votes;
}

export async function runSynthesis(ctx: PhaseCtx): Promise<void> {
  log.phase('Phase 5 · Synthesis');
  ctx.events.emit({ type: 'phase', phase: 'synthesis', label: 'Synthesis' });
  ctx.events.emit({ type: 'seat_working', actor: 'moderator', activity: 'writing the recommendation dossier' });
  const config = cfg(ctx);
  const lastVotes = [...ctx.state.rounds].reverse().find((r) => r.votes && r.votes.length > 0)?.votes ?? [];
  const activeIds = activeIdeas(ctx.state.ideas).map((i) => i.id);
  const leaderboard = computeLeaderboard(lastVotes, config.rubric, activeIds);
  const runnerUpId = leaderboard.find((e) => e.ideaId !== ctx.state.winnerId)?.ideaId;

  log.moderator('writing the recommendation dossier…');
  const text = await chatText(
    ctx,
    config.moderator.model,
    prompts.moderatorSystem(),
    prompts.synthesisUser(ctx.state, runnerUpId),
    null,
  );
  ctx.state.synthesis = text.trim();
  ctx.transcript(`\n## Synthesis\n\n${ctx.state.synthesis}\n`);
  ctx.events.emit({ type: 'message', actor: 'moderator', kind: 'synthesis', markdown: ctx.state.synthesis });
}

export async function runGrounding(ctx: PhaseCtx): Promise<void> {
  log.phase('Phase 6 · Grounding — fact-check of the recommendation');
  ctx.events.emit({ type: 'phase', phase: 'grounding', label: 'Grounding · fact-check' });
  const config = cfg(ctx);
  const synthesis = ctx.state.synthesis;
  if (!synthesis) throw new Error('grounding requested before synthesis was written');

  log.moderator('extracting the load-bearing claims…');
  ctx.events.emit({ type: 'seat_working', actor: 'moderator', activity: 'extracting load-bearing claims' });
  const claimsOut = await chatJson(
    ctx,
    'moderator/claims',
    config.moderator.model,
    prompts.moderatorSystem(),
    prompts.claimsUser(synthesis, config.grounding.maxClaims),
    ClaimsOutSchema,
    null,
  );
  const toVerify = claimsOut.claims.slice(0, config.grounding.maxClaims);
  log.info(`${toVerify.length} claim(s) to verify`);

  const settled = await Promise.allSettled(
    toVerify.map(async (claim, i) => {
      const id = `c${i + 1}`;
      ctx.events.emit({ type: 'seat_working', actor: 'moderator', activity: `verifying claim ${id}` });
      const out = await chatJson(
        ctx,
        `factcheck/${id}`,
        config.moderator.model,
        prompts.factCheckerSystem(),
        prompts.verifyClaimUser(claim.text, claim.importance),
        VerifyOutSchema,
        searchOpts(ctx),
      );
      return { id, claim, out };
    }),
  );

  let budgetError: BudgetExceededError | undefined;
  const claims: GroundedClaim[] = [];
  settled.forEach((outcome, i) => {
    const id = `c${i + 1}`;
    const claim = toVerify[i];
    if (outcome.status === 'fulfilled') {
      const { out } = outcome.value;
      claims.push({
        id,
        text: claim.text,
        importance: claim.importance,
        verdict: out.verdict,
        note: out.note,
        sources: out.sources,
      });
      addCitations(ctx.state, out.sources);
      return;
    }
    if (outcome.reason instanceof BudgetExceededError) {
      budgetError = outcome.reason;
      return;
    }
    const msg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    const warning = `claim ${id} could not be verified (${msg}) — recorded as unverified`;
    ctx.state.warnings.push(warning);
    log.warn(warning);
    ctx.events.emit({ type: 'warning', text: warning });
    claims.push({
      id,
      text: claim.text,
      importance: claim.importance,
      verdict: 'unverified',
      note: 'Verification did not complete; treat this claim with caution.',
      sources: [],
    });
  });
  if (budgetError) throw budgetError;

  ctx.state.grounding = { claims, summary: groundingSummary(claims) };
  const md = renderGroundingMd(ctx.state.grounding);
  ctx.events.emit({ type: 'message', actor: 'moderator', kind: 'grounding', markdown: md });
  ctx.transcript(`\n${md}\n`);
  log.moderator(ctx.state.grounding.summary);
}

export async function runRedTeam(ctx: PhaseCtx): Promise<void> {
  log.phase('Phase 7 · Red team — pre-mortem');
  ctx.events.emit({ type: 'phase', phase: 'redteam', label: 'Red team · pre-mortem' });
  const config = cfg(ctx);
  const synthesis = ctx.state.synthesis;
  if (!synthesis) throw new Error('red team requested before synthesis was written');

  const groundingMd = ctx.state.grounding ? renderGroundingMd(ctx.state.grounding) : undefined;
  const results = await perSeat(
    ctx,
    'red-teaming the recommendation',
    async (seat) => {
      const out = await chatJson(
        ctx,
        `${seat.id}/redteam`,
        seat.model,
        prompts.panelSystem(seat, config, personaFor(ctx.state.personas, seat)),
        prompts.redteamUser(synthesis, groundingMd),
        RedTeamOutSchema,
        null,
      );
      ctx.events.emit({
        type: 'message',
        actor: seat.id,
        kind: 'redteam',
        markdown: out.failures
          .map(
            (f) =>
              `**${f.title}** (${f.likelihood} likelihood, ${f.severity})\n\n${f.story}\n\n_Warning sign:_ ${f.warning_sign}\n\n_Mitigation:_ ${f.mitigation}`,
          )
          .join('\n\n---\n\n'),
      });
      return out;
    },
    1,
  );

  const failures: RedTeamFailure[] = results.flatMap(({ seat, result }) =>
    result.failures.map((f) => ({
      seatId: seat.id,
      title: f.title,
      story: f.story,
      likelihood: f.likelihood,
      severity: f.severity,
      warningSign: f.warning_sign,
      mitigation: f.mitigation,
    })),
  );

  log.moderator('consolidating the pre-mortem…');
  ctx.events.emit({ type: 'seat_working', actor: 'moderator', activity: 'consolidating the pre-mortem' });
  const modOut = await chatJson(
    ctx,
    'moderator/redteam',
    config.moderator.model,
    prompts.moderatorSystem(),
    prompts.redteamModeratorUser(synthesis, failuresDigestMd(failures)),
    RedTeamModeratorOutSchema,
    null,
  );

  const seatIds = new Set(config.seats.map((s) => s.id));
  ctx.state.redteam = {
    failures,
    topRisks: modOut.top_risks.map((r) => ({
      title: r.title,
      likelihood: r.likelihood,
      severity: r.severity,
      warningSign: r.warning_sign,
      mitigation: r.mitigation,
      raisedBy: r.raised_by.filter((id) => seatIds.has(id)),
    })),
    proceedConditions: modOut.proceed_conditions,
    summary: modOut.summary,
  };

  const md = renderRedTeamMd(ctx.state.redteam);
  ctx.events.emit({ type: 'message', actor: 'moderator', kind: 'redteam_summary', markdown: md });
  ctx.transcript(`\n${md}\n`);
  log.moderator(modOut.summary);
  log.info(`${ctx.state.redteam.topRisks.length} consolidated risk(s), ${modOut.proceed_conditions.length} proceed condition(s)`);
}

export async function runSignoff(ctx: PhaseCtx): Promise<void> {
  log.phase('Phase 8 · Sign-off');
  ctx.events.emit({ type: 'phase', phase: 'signoff', label: 'Sign-off' });
  const config = cfg(ctx);
  const synthesis = ctx.state.synthesis;
  if (!synthesis) throw new Error('sign-off requested before synthesis was written');
  const extras = {
    ...(ctx.state.grounding ? { groundingMd: renderGroundingMd(ctx.state.grounding) } : {}),
    ...(ctx.state.redteam ? { redteamMd: renderRedTeamMd(ctx.state.redteam) } : {}),
  };
  const results = await perSeat(
    ctx,
    'signing off',
    async (seat) => {
      const out = await chatJson(
        ctx,
        `${seat.id}/signoff`,
        seat.model,
        prompts.panelSystem(seat, config, personaFor(ctx.state.personas, seat)),
        prompts.signoffUser(synthesis, extras),
        SignoffOutSchema,
        null,
      );
      ctx.events.emit({
        type: 'message',
        actor: seat.id,
        kind: 'signoff',
        markdown: `**${out.verdict === 'sign' ? 'SIGNS the recommendation' : 'DISSENTS'}** — ${out.statement}`,
      });
      return out;
    },
    1,
  );
  ctx.state.signoffs = results.map(({ seat, result }) => ({
    seatId: seat.id,
    verdict: result.verdict,
    statement: result.statement,
  }));
  for (const s of ctx.state.signoffs) {
    if (s.verdict === 'sign') log.seat(s.seatId, 'SIGNS the recommendation');
    else log.seat(s.seatId, `DISSENTS: ${s.statement}`);
  }
  ctx.transcript(
    `\n## Sign-off\n` +
      ctx.state.signoffs.map((s) => `- **${s.seatId}**: ${s.verdict.toUpperCase()} — ${s.statement}`).join('\n') +
      '\n',
  );
}
