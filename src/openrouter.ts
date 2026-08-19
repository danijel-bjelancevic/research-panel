import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { log } from './log.js';
import type { Citation } from './types.js';

const BASE_URL = 'https://openrouter.ai/api/v1';
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 522, 524]);

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

const ErrorBodySchema = z
  .object({
    error: z.object({
      message: z.string().optional(),
      code: z.unknown().optional(),
    }),
  })
  .passthrough();

const ChatResponseSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.string().nullable().optional(),
                annotations: z
                  .array(
                    z
                      .object({
                        type: z.string(),
                        url_citation: z
                          .object({
                            url: z.string(),
                            title: z.string().optional(),
                          })
                          .passthrough()
                          .optional(),
                      })
                      .passthrough(),
                  )
                  .optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().optional(),
        completion_tokens: z.number().optional(),
        cost: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const ModelListSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string(),
        name: z.string().optional(),
        context_length: z.number().nullable().optional(),
        pricing: z
          .object({
            prompt: z.string().optional(),
            completion: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  ),
});

export interface ModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
  /** USD per 1M input tokens */
  promptPricePerM?: number;
  /** USD per 1M output tokens */
  completionPricePerM?: number;
}

export interface WebSearchOpts {
  engine: 'exa' | 'native' | 'parallel' | 'perplexity';
  maxResults: number;
}

export interface ChatCallOpts {
  model: string;
  system?: string;
  user: string;
  webSearch?: WebSearchOpts | null;
}

export interface ChatOutcome {
  text: string;
  citations: Citation[];
  costUsd: number;
}

export class OpenRouterClient {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    private readonly maxAttempts = 5,
  ) {}

  async chat(opts: ChatCallOpts): Promise<ChatOutcome> {
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    messages.push({ role: 'user', content: opts.user });

    const body: Record<string, unknown> = { model: opts.model, messages };
    if (opts.webSearch) {
      body.plugins = [
        { id: 'web', engine: opts.webSearch.engine, max_results: opts.webSearch.maxResults },
      ];
    }

    let lastError: OpenRouterError = new OpenRouterError('request never attempted');
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.attemptChat(body);
      } catch (err) {
        if (err instanceof OpenRouterError) {
          lastError = err;
          const retryable = err.status === undefined || RETRYABLE_STATUS.has(err.status);
          if (!retryable || attempt === this.maxAttempts) throw err;
          this.warnRetry(opts.model, err.message, attempt);
          await sleep(backoffMs(attempt));
          continue;
        }
        // Network failures, timeouts, aborted requests — retry.
        lastError = new OpenRouterError(
          `network error calling OpenRouter: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (attempt === this.maxAttempts) throw lastError;
        this.warnRetry(opts.model, lastError.message, attempt);
        await sleep(backoffMs(attempt));
      }
    }
    throw lastError;
  }

  private warnRetry(model: string, reason: string, attempt: number): void {
    log.warn(
      `${model}: attempt ${attempt}/${this.maxAttempts} failed (${reason}) — retrying; ` +
        `if this model is just slow, raise requestTimeoutMs in the config`,
    );
  }

  private async attemptChat(body: Record<string, unknown>): Promise<ChatOutcome> {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'research-panel',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const raw: unknown = await res.json().catch(() => null);

    if (!res.ok) {
      throw new OpenRouterError(`OpenRouter request failed (HTTP ${res.status}): ${errorMessage(raw)}`, res.status);
    }

    // Some upstream failures come back as HTTP 200 with an error payload.
    const asError = ErrorBodySchema.safeParse(raw);
    if (asError.success) {
      throw new OpenRouterError(`provider error: ${asError.data.error.message ?? 'unknown'}`, 502);
    }

    const parsed = ChatResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new OpenRouterError('unexpected response shape from OpenRouter', 502);
    }

    const message = parsed.data.choices[0]?.message;
    const text = message?.content ?? '';
    if (!text.trim()) {
      throw new OpenRouterError('model returned an empty completion', 502);
    }

    const citations: Citation[] = [];
    const seen = new Set<string>();
    for (const ann of message?.annotations ?? []) {
      if (ann.type === 'url_citation' && ann.url_citation && !seen.has(ann.url_citation.url)) {
        seen.add(ann.url_citation.url);
        const citation: Citation = { url: ann.url_citation.url };
        if (ann.url_citation.title) citation.title = ann.url_citation.title;
        citations.push(citation);
      }
    }

    return { text, citations, costUsd: parsed.data.usage?.cost ?? 0 };
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${BASE_URL}/models`, {
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new OpenRouterError(`could not fetch model list (HTTP ${res.status})`, res.status);
    }
    const raw: unknown = await res.json();
    const parsed = ModelListSchema.safeParse(raw);
    if (!parsed.success) {
      throw new OpenRouterError('unexpected model list shape from OpenRouter');
    }
    return parsed.data.data.map((m) => {
      const info: ModelInfo = { id: m.id };
      if (m.name) info.name = m.name;
      if (typeof m.context_length === 'number') info.contextLength = m.context_length;
      const promptPrice = m.pricing?.prompt ? Number.parseFloat(m.pricing.prompt) : Number.NaN;
      const completionPrice = m.pricing?.completion ? Number.parseFloat(m.pricing.completion) : Number.NaN;
      if (Number.isFinite(promptPrice)) info.promptPricePerM = promptPrice * 1_000_000;
      if (Number.isFinite(completionPrice)) info.completionPricePerM = completionPrice * 1_000_000;
      return info;
    });
  }
}

function errorMessage(raw: unknown): string {
  const parsed = ErrorBodySchema.safeParse(raw);
  if (parsed.success && parsed.data.error.message) return parsed.data.error.message;
  return 'no error details provided';
}

function backoffMs(attempt: number): number {
  const base = Math.min(1500 * 2 ** (attempt - 1), 30_000);
  return base + Math.floor(Math.random() * 500);
}
