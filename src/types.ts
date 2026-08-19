import { z } from 'zod';
import { ConfigSchema } from './config.js';

export const CitationSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const EvidenceSchema = z.object({
  claim: z.string(),
  url: z.string().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const IdeaSchema = z.object({
  id: z.string(),
  seatId: z.string(),
  status: z.enum(['active', 'dropped', 'merged']),
  statusReason: z.string().optional(),
  title: z.string(),
  one_liner: z.string(),
  description: z.string(),
  why_now: z.string(),
  risks: z.array(z.string()),
  evidence: z.array(EvidenceSchema),
  revisionNotes: z.array(z.string()),
});
export type Idea = z.infer<typeof IdeaSchema>;

export const CritiqueRecordSchema = z.object({
  seatId: z.string(),
  ideaId: z.string(),
  objection: z.string(),
  evidence: z.array(EvidenceSchema),
});
export type CritiqueRecord = z.infer<typeof CritiqueRecordSchema>;

export const MoveRecordSchema = z.object({
  seatId: z.string(),
  action: z.enum(['defend', 'revise', 'abandon']),
  ideaId: z.string(),
  reasoning: z.string(),
});
export type MoveRecord = z.infer<typeof MoveRecordSchema>;

export const MergeProposalRecordSchema = z.object({
  seatId: z.string(),
  ideaIds: z.array(z.string()),
  rationale: z.string(),
});
export type MergeProposalRecord = z.infer<typeof MergeProposalRecordSchema>;

export const SeatVoteSchema = z.object({
  seatId: z.string(),
  rankings: z.array(z.string()),
  scores: z.array(
    z.object({
      ideaId: z.string(),
      values: z.record(z.number()),
    }),
  ),
  rationale: z.string(),
});
export type SeatVote = z.infer<typeof SeatVoteSchema>;

export const RoundRecordSchema = z.object({
  round: z.number().int(),
  critiques: z.array(CritiqueRecordSchema),
  moves: z.array(MoveRecordSchema),
  mergeProposals: z.array(MergeProposalRecordSchema),
  roundSummary: z.string(),
  votes: z.array(SeatVoteSchema).nullable(),
});
export type RoundRecord = z.infer<typeof RoundRecordSchema>;

export const SignoffSchema = z.object({
  seatId: z.string(),
  verdict: z.enum(['sign', 'dissent']),
  statement: z.string(),
});
export type Signoff = z.infer<typeof SignoffSchema>;

export const PersonaRecordSchema = z.object({
  seatId: z.string(),
  text: z.string(),
  source: z.enum(['config', 'auto']),
});
export type PersonaRecord = z.infer<typeof PersonaRecordSchema>;

export const PhaseSchema = z.enum([
  'brief',
  'personas',
  'divergence',
  'checkpoint',
  'debate',
  'synthesis',
  'signoff',
  'done',
]);
export type Phase = z.infer<typeof PhaseSchema>;

export const SessionStateSchema = z.object({
  version: z.literal(1),
  topic: z.string(),
  ownerNotes: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  configSnapshot: ConfigSchema,
  brief: z.string().optional(),
  personas: z.array(PersonaRecordSchema).default([]),
  ideas: z.array(IdeaSchema),
  rounds: z.array(RoundRecordSchema),
  steerNotes: z.array(z.string()),
  nextPhase: PhaseSchema,
  nextRound: z.number().int(),
  winnerId: z.string().optional(),
  convergedAtRound: z.number().int().optional(),
  forcedByCap: z.boolean().optional(),
  synthesis: z.string().optional(),
  signoffs: z.array(SignoffSchema),
  citations: z.array(CitationSchema),
  warnings: z.array(z.string()),
  costUsd: z.number(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;
