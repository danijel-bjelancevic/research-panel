import type { z } from 'zod';

/**
 * Extract a JSON value from model output that may wrap it in prose or
 * markdown fences. Tries, in order: fenced ```json block, first balanced
 * object/array, the raw trimmed text.
 */
export function extractJson(text: string): unknown {
  const candidates: string[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const balanced = extractBalanced(text);
  if (balanced) candidates.push(balanced);
  candidates.push(text.trim());
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }
  return null;
}

function extractBalanced(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start] as '{' | '[';
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export type ParseResult<T> = { success: true; data: T } | { success: false; error: string };

export function parseJsonWith<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, text: string): ParseResult<T> {
  const raw = extractJson(text);
  if (raw === null) return { success: false, error: 'no parseable JSON found in the reply' };
  const result = schema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  const issues = result.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  return { success: false, error: `JSON does not match the required shape — ${issues}` };
}
