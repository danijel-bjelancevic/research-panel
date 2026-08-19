import type { SeatConfig } from './config.js';
import type { PersonaRecord } from './types.js';

export const FALLBACK_PERSONA =
  'The rigorous generalist. You are an evidence-first analyst who distrusts consensus reached quickly, ' +
  'probes the weakest link in every argument, and changes your mind only when shown evidence.';

function isAuto(seat: SeatConfig): boolean {
  return !seat.persona || seat.persona.trim().toLowerCase() === 'auto';
}

/** Seats whose persona the moderator must design for this topic. */
export function seatsNeedingPersona(seats: SeatConfig[]): SeatConfig[] {
  return seats.filter(isAuto);
}

/**
 * Combine config-pinned personas with moderator-generated ones into the
 * effective panel. Config always wins; a seat the moderator missed gets a
 * generic fallback rather than crashing the run.
 */
export function resolvePersonas(
  seats: SeatConfig[],
  generated: Array<{ seat_id: string; persona: string }>,
): { personas: PersonaRecord[]; warnings: string[] } {
  const warnings: string[] = [];
  const generatedBySeat = new Map(generated.map((g) => [g.seat_id, g.persona]));

  const personas: PersonaRecord[] = seats.map((seat) => {
    if (!isAuto(seat)) {
      return { seatId: seat.id, text: seat.persona as string, source: 'config' };
    }
    const text = generatedBySeat.get(seat.id);
    if (text) return { seatId: seat.id, text, source: 'auto' };
    warnings.push(`moderator did not produce a persona for seat "${seat.id}" — using a generic fallback`);
    return { seatId: seat.id, text: FALLBACK_PERSONA, source: 'auto' };
  });

  for (const g of generated) {
    if (!seats.some((s) => s.id === g.seat_id)) {
      warnings.push(`moderator produced a persona for unknown seat "${g.seat_id}" — ignored`);
    }
  }
  return { personas, warnings };
}

/** The persona a seat argues with; always defined, whatever state we resumed from. */
export function personaFor(personas: PersonaRecord[], seat: SeatConfig): string {
  const record = personas.find((p) => p.seatId === seat.id);
  if (record) return record.text;
  if (seat.persona && seat.persona.trim().toLowerCase() !== 'auto') return seat.persona;
  return FALLBACK_PERSONA;
}
