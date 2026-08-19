import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extractJson, parseJsonWith } from '../src/json.js';

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it('parses JSON inside a markdown fence', () => {
    expect(extractJson('Here you go:\n```json\n{"a": 1}\n```\nDone.')).toEqual({ a: 1 });
  });

  it('parses JSON surrounded by prose', () => {
    expect(extractJson('Sure! The answer is {"ideas": [{"title": "x"}]} — hope that helps.')).toEqual({
      ideas: [{ title: 'x' }],
    });
  });

  it('handles braces inside string values', () => {
    expect(extractJson('{"text": "a { tricky } value with \\" quote"}')).toEqual({
      text: 'a { tricky } value with " quote',
    });
  });

  it('handles nested arrays inside objects', () => {
    expect(extractJson('prefix {"a": [1, {"b": 2}]} suffix')).toEqual({ a: [1, { b: 2 }] });
  });

  it('parses a top-level array', () => {
    expect(extractJson('The list: [1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('returns null when there is no JSON', () => {
    expect(extractJson('no json here at all')).toBeNull();
  });

  it('returns null for unbalanced JSON', () => {
    expect(extractJson('{"a": ')).toBeNull();
  });
});

describe('parseJsonWith', () => {
  const schema = z.object({ n: z.number() });

  it('returns data on a schema match', () => {
    const result = parseJsonWith(schema, '{"n": 5}');
    expect(result).toEqual({ success: true, data: { n: 5 } });
  });

  it('reports schema mismatches with the failing path', () => {
    const result = parseJsonWith(schema, '{"n": "five"}');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('n');
  });

  it('reports missing JSON', () => {
    const result = parseJsonWith(schema, 'nothing');
    expect(result.success).toBe(false);
  });
});
