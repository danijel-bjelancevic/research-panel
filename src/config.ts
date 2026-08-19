import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const SeatSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(24)
    .regex(/^[a-z0-9-]+$/, 'seat id must be lowercase letters, digits or dashes'),
  model: z.string().min(1),
  /** Omit (or set to "auto") to have the moderator design a persona for the topic. */
  persona: z.string().min(1).optional(),
});

export const RubricItemSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9_]+$/, 'rubric key must be lowercase snake_case'),
  label: z.string().min(1),
  weight: z.number().positive().max(10).default(1),
});

const WebSearchSchema = z.object({
  enabled: z.boolean().default(true),
  engine: z.enum(['exa', 'native', 'parallel', 'perplexity']).default('exa'),
  maxResults: z.number().int().min(1).max(10).default(5),
});

const DEFAULT_RUBRIC = [
  { key: 'feasibility', label: 'Can a small team ship a credible v1 within ~6 months?', weight: 1 },
  { key: 'demand', label: 'Is there evidence people pay to solve this today?', weight: 1.5 },
  { key: 'differentiation', label: 'Why does this win against existing alternatives?', weight: 1 },
  { key: 'fit', label: 'Fit with the owner’s stated skills and constraints', weight: 1 },
  { key: 'upside', label: 'Size of the prize if it works', weight: 0.8 },
];

export const ConfigSchema = z
  .object({
    seats: z.array(SeatSchema).min(2).max(6),
    moderator: z.object({ model: z.string().min(1) }),
    ideasPerSeat: z.number().int().min(2).max(8).default(4),
    rounds: z
      .object({
        min: z.number().int().min(1).max(12).default(2),
        max: z.number().int().min(1).max(12).default(5),
      })
      .default({ min: 2, max: 5 }),
    convergence: z
      .object({
        agreeSeats: z.number().int().min(2).default(2),
      })
      .default({ agreeSeats: 2 }),
    webSearch: WebSearchSchema.default({ enabled: true, engine: 'exa', maxResults: 5 }),
    redTeam: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
    grounding: z
      .object({
        enabled: z.boolean().default(true),
        maxClaims: z.number().int().min(3).max(8).default(6),
      })
      .default({ enabled: true, maxClaims: 6 }),
    rubric: z.array(RubricItemSchema).min(2).max(10).default(DEFAULT_RUBRIC),
    maxCostUsd: z.number().positive().max(500).default(10),
    outputDir: z.string().min(1).default('~/research-panels'),
    requestTimeoutMs: z.number().int().min(30_000).max(1_200_000).default(300_000),
  })
  .superRefine((cfg, ctx) => {
    const ids = cfg.seats.map((s) => s.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['seats'], message: 'seat ids must be unique' });
    }
    if (cfg.convergence.agreeSeats > cfg.seats.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['convergence', 'agreeSeats'],
        message: `agreeSeats (${cfg.convergence.agreeSeats}) cannot exceed the number of seats (${cfg.seats.length})`,
      });
    }
    if (cfg.rounds.min > cfg.rounds.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rounds'],
        message: 'rounds.min cannot exceed rounds.max',
      });
    }
    const keys = cfg.rubric.map((r) => r.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rubric'], message: 'rubric keys must be unique' });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;
export type SeatConfig = z.infer<typeof SeatSchema>;
export type RubricItem = z.infer<typeof RubricItemSchema>;

/**
 * Seats ship without personas: the moderator designs topic-fitted personas
 * after writing the research brief. Pin a persona on a seat to override.
 */
export const DEFAULT_CONFIG: Config = ConfigSchema.parse({
  seats: [
    { id: 'claude', model: 'anthropic/claude-sonnet-5' },
    { id: 'gpt', model: 'openai/gpt-5.2' },
    { id: 'gemini', model: 'google/gemini-3.1-pro-preview' },
  ],
  moderator: { model: 'anthropic/claude-sonnet-5' },
});

export interface ConfigOverrides {
  maxRounds?: number;
  webSearch?: boolean;
  maxCostUsd?: number;
  outputDir?: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(path: string, overrides: ConfigOverrides = {}): Config {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new ConfigError(
      `Config file not found at ${path}. Run "research-panel init" to create one, or pass --config <path>.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`Config file ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new ConfigError(`Config file ${path} is invalid:\n${issues}`);
  }
  return applyOverrides(result.data, overrides);
}

export function applyOverrides(config: Config, overrides: ConfigOverrides): Config {
  const next: Config = structuredClone(config);
  if (overrides.maxRounds !== undefined) {
    if (!Number.isInteger(overrides.maxRounds) || overrides.maxRounds < 1 || overrides.maxRounds > 12) {
      throw new ConfigError('--rounds must be an integer between 1 and 12');
    }
    next.rounds.max = overrides.maxRounds;
    next.rounds.min = Math.min(next.rounds.min, overrides.maxRounds);
  }
  if (overrides.webSearch !== undefined) next.webSearch.enabled = overrides.webSearch;
  if (overrides.maxCostUsd !== undefined) {
    if (!Number.isFinite(overrides.maxCostUsd) || overrides.maxCostUsd <= 0 || overrides.maxCostUsd > 500) {
      throw new ConfigError('--max-cost must be a positive number up to 500');
    }
    next.maxCostUsd = overrides.maxCostUsd;
  }
  if (overrides.outputDir !== undefined) next.outputDir = overrides.outputDir;
  return next;
}
