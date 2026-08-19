import type { Config, SeatConfig } from './config.js';
import type { RoundRecord, SessionState } from './types.js';
import { activeIdeas, findIdea, renderBoardMarkdown } from './board.js';

export function panelSystem(seat: SeatConfig, config: Config, persona: string): string {
  return `You are "${seat.id}", one of ${config.seats.length} AI panelists on a research panel. Each panelist runs on a different foundation model; a separate moderator model keeps the shared idea board tidy. The panel's job is to find the single strongest answer to the owner's research question through proposal, adversarial debate, and voting.

Your persona on this panel: ${persona}

Panel rules:
- Your value comes from independent thinking and honest disagreement. Never agree merely to converge, and never soften a real objection out of politeness.
- Ground claims in evidence. When you draw on web search results, put the source URL in the evidence fields of the JSON you return.
- Be concrete and specific. Generic advice and startup platitudes are worthless here.
- When you change your mind, say exactly what changed it. When you hold your position, engage the strongest counter-argument, not the weakest.
- When asked for JSON, reply with ONLY the JSON object — no prose before or after, no markdown fences.`;
}

export function divergenceSystem(seat: SeatConfig, config: Config): string {
  return `You are "${seat.id}", one of ${config.seats.length} AI panelists on a research panel. Each panelist runs on a different foundation model. The panel's job is to find the single strongest answer to the owner's research question through proposal, adversarial debate, and voting.

For this proposal phase you argue as yourself — no assigned persona. Bring your model's own judgment, taste, and priors: the panel needs your genuinely different perspective, not a role. Adversarial lenses are assigned in later phases; right now, breadth and originality win.

Panel rules:
- Ground claims in evidence. When you draw on web search results, put the source URL in the evidence fields of the JSON you return.
- Be concrete and specific. Generic advice and startup platitudes are worthless here.
- When asked for JSON, reply with ONLY the JSON object — no prose before or after, no markdown fences.`;
}

export function moderatorSystem(): string {
  return `You are the impartial moderator of a research panel of AI models. You never contribute ideas of your own and you have no favorites. Your duties: keep the shared idea board free of duplicates, remove ideas the debate has genuinely killed, and summarize each round faithfully — including disagreement, without smoothing it over. When asked for JSON, reply with ONLY the JSON object — no prose, no markdown fences.`;
}

export function briefUser(topic: string, ownerNotes?: string): string {
  return `Expand the following research topic into a crisp research brief for a panel of AI models. Maximum ~400 words, markdown.

Topic: ${topic}
${ownerNotes ? `\nThe panel owner adds these notes and constraints:\n${ownerNotes}\n` : ''}
The brief must cover: context (what space this is and its current state), the exact question the panel must answer, constraints stated or clearly implied by the owner, what a winning answer must demonstrate, and 3–5 key questions the panel should resolve along the way. Use web search to anchor the brief in the current state of the space — cite nothing older than necessary. Do NOT propose any solutions yourself; that is the panel's job.`;
}

export function personasUser(brief: string, seatIds: string[], boardMd?: string): string {
  return `The research panel needs personas designed for this specific brief before the debate starts.

Research brief:
${brief}
${boardMd ? `\n## The proposals on the board (from blind divergence)\n${boardMd}\n` : ''}
Design exactly ${seatIds.length} panelist persona(s), one for each of these seat ids: ${seatIds.join(', ')}.

Requirements:
- Each persona is a distinct analytical lens tailored to THIS brief's domain. Together they must cover the main ways an answer to this brief could be wrong.${
    boardMd
      ? '\n- Design the lenses to stress-test the proposals actually on the board above: target the failure modes that matter for THESE ideas, not generic archetypes.'
      : ''
  }
- Orthogonal, not variations: each persona must care most about a failure mode the other personas would forgive.
- At least one persona must be a designated skeptic whose default position is that a proposed answer fails.
- Adversarial but constructive: personas argue from evidence, not temperament. No contrarianism for its own sake.
- Write each persona in second person, 2–4 sentences, opening with a short epithet (e.g. "The regulatory pedant.").
- Do not mention specific AI models or vendors.

Reply with ONLY JSON in exactly this shape:
{ "personas": [ { "seat_id": "${seatIds[0] ?? 'seat-id'}", "persona": "The ... . You ..." } ] }`;
}

export function divergenceUser(brief: string, config: Config): string {
  return `${brief}

---

You are working blind: you cannot see the other panelists' proposals, and they cannot see yours. Propose your ${config.ideasPerSeat} strongest, mutually distinct answers to the brief. Favor ideas that are specific enough to attack — a vague idea will not survive this panel's debate phase. Use web search to check how crowded each space is and to find evidence of real demand; cite URLs.

Make the set genuinely diverse: span different customer types, business models, and risk levels, and include at least one contrarian or unfashionable idea you would still defend on evidence. Do not converge on the obvious first answer to the brief.

Reply with ONLY JSON in exactly this shape:
{
  "ideas": [
    {
      "title": "Short name",
      "one_liner": "One sentence: what it is and for whom",
      "description": "150–250 words: what it is, who pays, how it works, how it reaches its first customers",
      "why_now": "Why this is possible/valuable now and wasn't two years ago",
      "risks": ["The most serious ways this fails"],
      "evidence": [{ "claim": "What the source shows", "url": "https://..." }]
    }
  ]
}`;
}

function renderLastRoundCritiques(rounds: RoundRecord[]): string {
  const last = rounds.at(-1);
  if (!last) return '';
  const lines: string[] = [`Critiques raised in round ${last.round}:`];
  for (const c of last.critiques) {
    lines.push(`- [${c.seatId} → ${c.ideaId}] ${c.objection}`);
  }
  if (last.roundSummary) lines.push(`\nModerator's summary of round ${last.round}: ${last.roundSummary}`);
  return lines.join('\n');
}

function renderSteerNotes(state: SessionState): string {
  if (state.steerNotes.length === 0) return '';
  return `The panel owner (a human) has added steering notes — treat these as binding constraints:\n${state.steerNotes
    .map((n) => `- ${n}`)
    .join('\n')}\n`;
}

export function debateUser(state: SessionState, seat: SeatConfig, round: number): string {
  const config = state.configSnapshot;
  const board = renderBoardMarkdown(state.ideas, { truncateDescription: 1200 });
  const ownActive = activeIdeas(state.ideas).filter((i) => i.seatId === seat.id);
  const ownNote =
    ownActive.length > 0
      ? `Your own ideas still on the board: ${ownActive.map((i) => i.id).join(', ')}. Your own_move must target one of them.`
      : `None of your original ideas remain on the board. For own_move, use action "defend" with the idea_id of the active idea you now most support, and explain why in reasoning.`;

  return `Debate round ${round} of at most ${config.rounds.max}.

Research brief (abridged): ${state.brief ? state.brief.slice(0, 1500) : state.topic}

${renderSteerNotes(state)}
## Current idea board
${board}
${renderLastRoundCritiques(state.rounds)}

Your tasks this round:
1. ATTACK: pick the two strongest ideas on the board that are NOT yours and raise your most damaging specific objection against each. Use web search where a fact would settle it; cite URLs in evidence. An objection that would apply to any idea is worthless.
2. OWN MOVE: ${ownNote} Choose "defend" (answer the strongest objection against it), "revise" (change the idea to survive the objections — supply only the fields that change), or "abandon" (concede it is beaten).
3. Optionally propose a merge if two ideas on the board are genuinely the same underlying idea.

Reply with ONLY JSON in exactly this shape:
{
  "critiques": [
    { "idea_id": "seat-1", "objection": "Specific, damaging, falsifiable objection", "evidence": [{ "claim": "...", "url": "https://..." }] }
  ],
  "own_move": {
    "action": "defend" | "revise" | "abandon",
    "idea_id": "your-idea-id",
    "revision": { "title": "...", "one_liner": "...", "description": "...", "why_now": "...", "risks": ["..."], "evidence": [] },
    "reasoning": "Why this move; if defending, your answer to the strongest objection"
  },
  "merge_proposal": { "idea_ids": ["a-1", "b-2"], "rationale": "..." }
}
Omit "revision" unless the action is "revise"; set "merge_proposal" to null if you have none.`;
}

export function moderatorMergeUser(
  state: SessionState,
  round: number,
  data: { critiquesMd: string; movesMd: string; mergeProposalsMd: string },
): string {
  const board = renderBoardMarkdown(state.ideas, { truncateDescription: 800 });
  return `Round ${round} of debate has finished. Tidy the board.

## Current idea board (after the seats' own moves were applied)
${board}

## Critiques raised this round
${data.critiquesMd || '(none)'}

## Seats' own moves this round
${data.movesMd || '(none)'}

## Merge proposals from seats
${data.mergeProposalsMd || '(none)'}

Your tasks:
1. MERGE ideas only when they are genuinely the same underlying idea; keep the stronger formulation (keep_id) and absorb the rest.
2. DROP an idea only when the debate has genuinely killed it — a decisive unanswered objection, not your own taste. If the board has more than 8 active ideas, also drop the clearly weakest until at most 8 remain.
3. Summarize the round in at most 150 words: what was attacked, what survived, what changed, where the seats still disagree. Be faithful to disagreement; do not smooth it over.

Reply with ONLY JSON in exactly this shape:
{
  "merges": [{ "keep_id": "a-1", "absorb_ids": ["b-2"], "reason": "..." }],
  "drops": [{ "idea_id": "c-3", "reason": "..." }],
  "round_summary": "..."
}
Use empty arrays when there is nothing to merge or drop.`;
}

export function voteUser(state: SessionState): string {
  const config = state.configSnapshot;
  const board = renderBoardMarkdown(state.ideas, { truncateDescription: 800 });
  const rubric = config.rubric
    .map((r) => `- "${r.key}" (weight ${r.weight}): ${r.label}`)
    .join('\n');
  return `Voting time. Judge every ACTIVE idea on the board against the rubric.

${renderSteerNotes(state)}
## Idea board
${board}

## Rubric (score each key 0–10)
${rubric}

Rules: score EVERY active idea on EVERY rubric key. Rank your top 3 by overall judgment — the rubric informs your ranking but does not replace it. You may rank your own ideas, but judge them exactly as harshly as the others; the debate record is your evidence. Do not converge for the sake of converging.

Reply with ONLY JSON in exactly this shape:
{
  "rankings": ["best-idea-id", "second", "third"],
  "scores": [
    { "idea_id": "a-1", "values": { ${config.rubric.map((r) => `"${r.key}": 0`).join(', ')} } }
  ],
  "rationale": "2–4 sentences: why your #1 wins and what would change your mind"
}`;
}

export function synthesisUser(state: SessionState, runnerUpId?: string): string {
  const winner = state.winnerId ? findIdea(state.ideas, state.winnerId) : undefined;
  if (!winner) throw new Error('synthesis requested without a winner on the board');
  const runnerUp = runnerUpId ? findIdea(state.ideas, runnerUpId) : undefined;

  const critiques: string[] = [];
  const voteRationales: string[] = [];
  const summaries: string[] = [];
  for (const round of state.rounds) {
    for (const c of round.critiques) {
      if (c.ideaId === winner.id) critiques.push(`- [round ${round.round}, ${c.seatId}] ${c.objection}`);
    }
    if (round.roundSummary) summaries.push(`- Round ${round.round}: ${round.roundSummary}`);
    for (const v of round.votes ?? []) {
      voteRationales.push(`- [round ${round.round}, ${v.seatId}] ${v.rationale}`);
    }
  }

  return `The panel has selected a winning idea. Write the final recommendation dossier section.

Research brief: ${state.brief ?? state.topic}

${renderSteerNotes(state)}
## Winning idea
${renderBoardMarkdown([winner])}
Revision history: ${winner.revisionNotes.length > 0 ? winner.revisionNotes.join(' | ') : '(unrevised)'}

## Every critique raised against it
${critiques.join('\n') || '(none recorded)'}

## Vote rationales
${voteRationales.join('\n') || '(none recorded)'}

## Round summaries
${summaries.join('\n') || '(none)'}
${runnerUp ? `\n## Runner-up (for contrast)\n${runnerUp.id}: ${runnerUp.title} — ${runnerUp.one_liner}\n` : ''}
Write in markdown, 600–1000 words, with exactly these sections:
## Recommendation
## Why this won
## The strongest objections — and where they stand
## Risks and mitigations
## First step: a 2–4 week validation experiment
## Open questions

Be faithful to the debate: where an objection was never convincingly answered, say so plainly. No JSON, no preamble — start directly with "## Recommendation".`;
}

export function factCheckerSystem(): string {
  return `You are an impartial fact-checker attached to a research panel of AI models. You verify one claim at a time using web search. Rules: prefer primary and recent sources; a claim is "supported" only when independent credible sources confirm it, "contested" when credible sources disagree with it or with each other, and "unverified" when you cannot find sufficient evidence either way. Never assert beyond what the sources show, and never let the claim's plausibility substitute for evidence. When asked for JSON, reply with ONLY the JSON object — no prose, no markdown fences.`;
}

export function claimsUser(synthesis: string, maxClaims: number): string {
  return `Below is a research panel's final recommendation dossier. Extract its LOAD-BEARING factual claims for verification.

---
${synthesis}
---

A load-bearing claim is an empirical, checkable statement the recommendation depends on: market sizes, competitor facts, pricing, regulations, technology capabilities, adoption numbers. If it turned out false, the recommendation would weaken or collapse.

Rules:
- Only checkable facts about the world. No opinions, no predictions, no statements about the panel itself.
- Each claim self-contained: understandable and verifiable without reading the dossier.
- At most ${maxClaims}, ordered by how much the recommendation rests on them.
- For each, state in one sentence why the recommendation depends on it.

Reply with ONLY JSON in exactly this shape:
{ "claims": [ { "text": "The checkable claim as one sentence", "importance": "Why the recommendation rests on this" } ] }`;
}

export function verifyClaimUser(claim: string, importance: string): string {
  return `Verify this claim with web search.

Claim: ${claim}
Why it matters: ${importance}

Search for evidence, weigh the sources, and give your verdict:
- "supported": independent credible sources confirm it.
- "contested": credible sources disagree with the claim or with each other.
- "unverified": you could not find sufficient evidence either way.

The note must say what the evidence actually shows in 1–3 sentences, including numbers and dates where they matter. List the sources you relied on.

Reply with ONLY JSON in exactly this shape:
{ "verdict": "supported" | "contested" | "unverified", "note": "...", "sources": [ { "url": "https://...", "title": "..." } ] }`;
}

export function redteamUser(synthesis: string, groundingMd?: string): string {
  return `The panel has converged on the recommendation below. Before sign-off, run a PRE-MORTEM on it.

---
${synthesis}
---
${groundingMd ? `\nA fact-check of the recommendation's load-bearing claims has already run. Weigh contested or unverified claims heavily — a recommendation resting on a shaky fact is a failure story waiting to happen:\n\n${groundingMd}\n` : ''}
Imagine it is 12 months from now. The owner followed this recommendation, and it FAILED. Through your persona's lens, write the 2 to 3 most plausible, distinct failure stories. Rules:
- Each failure must be specific to THIS recommendation. A failure story that would apply to any project is worthless.
- Attack the recommendation's actual load-bearing assumptions: demand, distribution, execution capacity, timing, competition, regulation — whatever it truly rests on.
- "likelihood" is how probable the failure is if the owner proceeds as recommended. "severity" is the damage if it happens: "annoying" (recoverable setback), "serious" (major loss of time or money), "fatal" (kills the project).
- The warning sign must be observable EARLY — something the owner could notice within weeks, not after the failure.
- The mitigation must be an action available to the owner now or at the warning sign, not hindsight.

Reply with ONLY JSON in exactly this shape:
{
  "failures": [
    {
      "title": "Short name of the failure",
      "story": "3–5 sentences telling how it plausibly unfolded",
      "likelihood": "low" | "medium" | "high",
      "severity": "annoying" | "serious" | "fatal",
      "warning_sign": "The earliest observable signal that this failure is starting",
      "mitigation": "The concrete action that prevents or contains it"
    }
  ]
}`;
}

export function redteamModeratorUser(synthesis: string, failuresDigest: string): string {
  return `The panel ran a pre-mortem on the recommendation below. Consolidate it.

## The recommendation (abridged)
${synthesis.slice(0, 2000)}

## Failure stories from the seats
${failuresDigest}

Your tasks:
1. Merge duplicate or overlapping failures into single risks; credit every seat that raised each one in raised_by.
2. Keep only genuine, recommendation-specific risks — drop generic filler. At most 6.
3. For each risk keep the sharpest warning sign and the most actionable mitigation offered (or tighten them).
4. Write proceed_conditions: 1 to 5 concrete conditions under which the owner should proceed (or checkpoints that would trigger a stop).
5. Summarize the pre-mortem in at most 120 words, faithful to how worried the panel actually is.

Reply with ONLY JSON in exactly this shape:
{
  "top_risks": [
    { "title": "...", "likelihood": "low" | "medium" | "high", "severity": "annoying" | "serious" | "fatal", "warning_sign": "...", "mitigation": "...", "raised_by": ["seat-id"] }
  ],
  "proceed_conditions": ["..."],
  "summary": "..."
}`;
}

export function signoffUser(
  synthesis: string,
  extras: { groundingMd?: string; redteamMd?: string } = {},
): string {
  return `Below is the panel's final recommendation dossier. Give your verdict.

---
${synthesis}
---
${extras.groundingMd ? `\nA fact-check of the recommendation's load-bearing claims:\n\n${extras.groundingMd}\n` : ''}${extras.redteamMd ? `\nThe panel also ran a pre-mortem on this recommendation. Sign or dissent with these risks in front of you:\n\n${extras.redteamMd}\n` : ''}
"sign" means: you endorse this recommendation as the panel's best answer, including its stated risks. "dissent" means you do not — and your statement must say precisely why and what evidence would change your mind. A dissent is respected, recorded in the dossier, and does not block the recommendation; do NOT sign out of politeness.

Reply with ONLY JSON in exactly this shape:
{ "verdict": "sign" | "dissent", "statement": "2–5 sentences" }`;
}
