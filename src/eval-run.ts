import { writeFileSync } from 'node:fs';
import type { z } from 'zod';
import { CostTracker } from './cost.js';
import { renderEvalMd, resolveOutcome } from './eval.js';
import { log } from './log.js';
import { parseJsonWith } from './json.js';
import type { OpenRouterClient, WebSearchOpts } from './openrouter.js';
import * as prompts from './prompts.js';
import { JudgeOutSchema, type JudgeOut } from './schemas.js';
import type { SessionPaths } from './session.js';
import type { EvalJudging, EvalRecord, SessionState } from './types.js';

export interface EvalOpts {
  client: OpenRouterClient;
  paths: SessionPaths;
  state: SessionState;
  baselineModel: string;
  judgeModel: string;
  maxCostUsd: number;
  search: WebSearchOpts | null;
}

async function chatJson<T>(
  client: OpenRouterClient,
  tracker: CostTracker,
  label: string,
  model: string,
  system: string,
  user: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  tracker.ensure();
  const first = await client.chat({ model, system, user, webSearch: null });
  tracker.add(first.costUsd);
  const parsed = parseJsonWith(schema, first.text);
  if (parsed.success) return parsed.data;

  log.warn(`${label}: reply was not usable JSON — requesting a repair`);
  tracker.ensure();
  const repairUser =
    `${user}\n\n---\nYour previous reply could not be used. Problem: ${parsed.error}\n` +
    `Your previous reply (truncated):\n${first.text.slice(0, 4000)}\n\n` +
    `Reply again with ONLY the JSON object — no prose, no markdown fences.`;
  const second = await client.chat({ model, system, user: repairUser, webSearch: null });
  tracker.add(second.costUsd);
  const parsed2 = parseJsonWith(schema, second.text);
  if (parsed2.success) return parsed2.data;
  throw new Error(`${label}: unusable JSON after one repair attempt (${parsed2.error})`);
}

function toJudging(order: EvalJudging['order'], out: JudgeOut): EvalJudging {
  const aIsPanel = order === 'panel-first';
  const byCandidate = (letter: 'A' | 'B'): Record<string, number> =>
    out.scores.find((s) => s.candidate === letter)?.values ?? {};
  const winner =
    out.winner === 'tie' ? 'tie' : (out.winner === 'A') === aIsPanel ? 'panel' : 'baseline';
  return {
    order,
    winner,
    margin: out.margin,
    rationale: out.rationale,
    scores: {
      panel: byCandidate(aIsPanel ? 'A' : 'B'),
      baseline: byCandidate(aIsPanel ? 'B' : 'A'),
    },
  };
}

export async function runEval(opts: EvalOpts): Promise<EvalRecord> {
  const { client, paths, state } = opts;
  const synthesis = state.synthesis;
  if (!synthesis) {
    throw new Error('this session has no synthesis yet — finish the run before evaluating it');
  }
  const brief = state.brief ?? state.topic;
  const config = state.configSnapshot;
  const tracker = new CostTracker(opts.maxCostUsd, 0);

  log.phase('Eval · baseline dossier');
  log.info(`baseline: one dossier from ${opts.baselineModel}, same brief${opts.search ? ', web search on' : ''}`);
  tracker.ensure();
  const baselineRes = await client.chat({
    model: opts.baselineModel,
    system: prompts.baselineSystem(),
    user: prompts.baselineUser(brief, config.ideasPerSeat),
    webSearch: opts.search,
  });
  tracker.add(baselineRes.costUsd);
  const baselineDossier = baselineRes.text.trim();
  const baselineCostUsd = baselineRes.costUsd;

  log.phase('Eval · blinded judging (both orders)');
  const rubricLines = config.rubric.map((r) => `- "${r.key}" (weight ${r.weight}): ${r.label}`).join('\n');
  const judgeCostBefore = tracker.spentUsd;

  const judgings: EvalJudging[] = [];
  for (const order of ['panel-first', 'baseline-first'] as const) {
    const [a, b] = order === 'panel-first' ? [synthesis, baselineDossier] : [baselineDossier, synthesis];
    log.info(`judging with ${order === 'panel-first' ? 'the panel' : 'the baseline'} as candidate A…`);
    const out = await chatJson(
      client,
      tracker,
      `judge/${order}`,
      opts.judgeModel,
      prompts.judgeSystem(),
      prompts.judgeUser(brief, rubricLines, a, b),
      JudgeOutSchema,
    );
    judgings.push(toJudging(order, out));
  }
  const judgeCostUsd = tracker.spentUsd - judgeCostBefore;

  const combined = resolveOutcome(judgings[0], judgings[1]);
  const record: EvalRecord = {
    createdAt: new Date().toISOString(),
    topic: state.topic,
    baselineModel: opts.baselineModel,
    judgeModel: opts.judgeModel,
    panelCostUsd: state.costUsd,
    baselineCostUsd,
    judgeCostUsd,
    outcome: combined.outcome,
    ...(combined.margin ? { margin: combined.margin } : {}),
    judgings,
    baselineDossier,
  };

  writeFileSync(paths.evalJsonPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  writeFileSync(paths.evalMdPath, renderEvalMd(record, config.rubric), 'utf8');
  return record;
}
