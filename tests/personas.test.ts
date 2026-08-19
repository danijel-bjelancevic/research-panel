import { describe, expect, it } from 'vitest';
import { FALLBACK_PERSONA, personaFor, resolvePersonas, seatsNeedingPersona } from '../src/personas.js';
import type { SeatConfig } from '../src/config.js';

const seats: SeatConfig[] = [
  { id: 'claude', model: 'anthropic/claude-sonnet-5' },
  { id: 'gpt', model: 'openai/gpt-5.2', persona: 'auto' },
  { id: 'gemini', model: 'google/gemini-3.1-pro-preview', persona: 'The pinned skeptic. You doubt everything.' },
];

describe('seatsNeedingPersona', () => {
  it('selects seats with no persona or the literal "auto"', () => {
    expect(seatsNeedingPersona(seats).map((s) => s.id)).toEqual(['claude', 'gpt']);
  });
});

describe('resolvePersonas', () => {
  it('config-pinned personas win; generated fill the rest', () => {
    const { personas, warnings } = resolvePersonas(seats, [
      { seat_id: 'claude', persona: 'The builder.' },
      { seat_id: 'gpt', persona: 'The economist.' },
    ]);
    expect(warnings).toEqual([]);
    expect(personas).toEqual([
      { seatId: 'claude', text: 'The builder.', source: 'auto' },
      { seatId: 'gpt', text: 'The economist.', source: 'auto' },
      { seatId: 'gemini', text: 'The pinned skeptic. You doubt everything.', source: 'config' },
    ]);
  });

  it('a generated persona never overrides a pinned one', () => {
    const { personas } = resolvePersonas(seats, [
      { seat_id: 'claude', persona: 'The builder.' },
      { seat_id: 'gpt', persona: 'The economist.' },
      { seat_id: 'gemini', persona: 'Should be ignored.' },
    ]);
    expect(personas.find((p) => p.seatId === 'gemini')?.text).toBe('The pinned skeptic. You doubt everything.');
    expect(personas.find((p) => p.seatId === 'gemini')?.source).toBe('config');
  });

  it('falls back with a warning when the moderator misses a seat', () => {
    const { personas, warnings } = resolvePersonas(seats, [{ seat_id: 'claude', persona: 'The builder.' }]);
    expect(personas.find((p) => p.seatId === 'gpt')?.text).toBe(FALLBACK_PERSONA);
    expect(warnings.some((w) => w.includes('"gpt"'))).toBe(true);
  });

  it('warns about personas for unknown seats and ignores them', () => {
    const { personas, warnings } = resolvePersonas(seats, [
      { seat_id: 'claude', persona: 'The builder.' },
      { seat_id: 'gpt', persona: 'The economist.' },
      { seat_id: 'ghost', persona: 'Nobody.' },
    ]);
    expect(personas).toHaveLength(3);
    expect(warnings.some((w) => w.includes('"ghost"'))).toBe(true);
  });
});

describe('personaFor', () => {
  it('reads from resolved personas first', () => {
    const personas = [{ seatId: 'claude', text: 'The builder.', source: 'auto' as const }];
    expect(personaFor(personas, seats[0])).toBe('The builder.');
  });

  it('falls back to the config persona when state has none (old sessions)', () => {
    expect(personaFor([], seats[2])).toBe('The pinned skeptic. You doubt everything.');
  });

  it('falls back to the generic persona as a last resort', () => {
    expect(personaFor([], seats[0])).toBe(FALLBACK_PERSONA);
    expect(personaFor([], seats[1])).toBe(FALLBACK_PERSONA);
  });
});
