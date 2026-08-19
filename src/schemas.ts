import { z } from 'zod';

/**
 * Zod schemas for the JSON the panel models are asked to produce.
 * Every model call that expects structured output validates against one of
 * these; a failed parse triggers one repair round-trip before giving up.
 */

export const EvidenceOutSchema = z.object({
  claim: z.string(),
  url: z.string().optional(),
});

export const IdeaOutSchema = z.object({
  title: z.string().min(1),
  one_liner: z.string().min(1),
  description: z.string().min(1),
  why_now: z.string().min(1),
  risks: z.array(z.string()).default([]),
  evidence: z.array(EvidenceOutSchema).default([]),
});
export type IdeaOut = z.infer<typeof IdeaOutSchema>;

export const DivergenceOutSchema = z.object({
  ideas: z.array(IdeaOutSchema).min(1),
});
export type DivergenceOut = z.infer<typeof DivergenceOutSchema>;

export const CritiqueOutSchema = z.object({
  idea_id: z.string(),
  objection: z.string().min(1),
  evidence: z.array(EvidenceOutSchema).default([]),
});

export const MoveOutSchema = z.object({
  action: z.enum(['defend', 'revise', 'abandon']),
  idea_id: z.string(),
  revision: IdeaOutSchema.partial().optional(),
  reasoning: z.string().min(1),
});
export type MoveOut = z.infer<typeof MoveOutSchema>;

export const DebateOutSchema = z.object({
  critiques: z.array(CritiqueOutSchema).min(1),
  own_move: MoveOutSchema,
  merge_proposal: z
    .object({
      idea_ids: z.array(z.string()).min(2),
      rationale: z.string(),
    })
    .nullish(),
});
export type DebateOut = z.infer<typeof DebateOutSchema>;

export const ModeratorMergeOutSchema = z.object({
  merges: z
    .array(
      z.object({
        keep_id: z.string(),
        absorb_ids: z.array(z.string()).min(1),
        reason: z.string(),
      }),
    )
    .default([]),
  drops: z
    .array(
      z.object({
        idea_id: z.string(),
        reason: z.string(),
      }),
    )
    .default([]),
  round_summary: z.string().min(1),
});
export type ModeratorMergeOut = z.infer<typeof ModeratorMergeOutSchema>;

export const VoteOutSchema = z.object({
  rankings: z.array(z.string()).min(1).max(3),
  scores: z
    .array(
      z.object({
        idea_id: z.string(),
        values: z.record(z.number().min(0).max(10)),
      }),
    )
    .min(1),
  rationale: z.string().min(1),
});
export type VoteOut = z.infer<typeof VoteOutSchema>;

export const PersonasOutSchema = z.object({
  personas: z
    .array(
      z.object({
        seat_id: z.string(),
        persona: z.string().min(1),
      }),
    )
    .min(1),
});
export type PersonasOut = z.infer<typeof PersonasOutSchema>;

export const SignoffOutSchema = z.object({
  verdict: z.enum(['sign', 'dissent']),
  statement: z.string().min(1),
});
export type SignoffOut = z.infer<typeof SignoffOutSchema>;

export const RedTeamOutSchema = z.object({
  failures: z
    .array(
      z.object({
        title: z.string().min(1),
        story: z.string().min(1),
        likelihood: z.enum(['low', 'medium', 'high']),
        severity: z.enum(['annoying', 'serious', 'fatal']),
        warning_sign: z.string().min(1),
        mitigation: z.string().min(1),
      }),
    )
    .min(1)
    .max(4),
});
export type RedTeamOut = z.infer<typeof RedTeamOutSchema>;

export const RedTeamModeratorOutSchema = z.object({
  top_risks: z
    .array(
      z.object({
        title: z.string().min(1),
        likelihood: z.enum(['low', 'medium', 'high']),
        severity: z.enum(['annoying', 'serious', 'fatal']),
        warning_sign: z.string().min(1),
        mitigation: z.string().min(1),
        raised_by: z.array(z.string()).default([]),
      }),
    )
    .min(1)
    .max(6),
  proceed_conditions: z.array(z.string().min(1)).min(1).max(5),
  summary: z.string().min(1),
});
export type RedTeamModeratorOut = z.infer<typeof RedTeamModeratorOutSchema>;
