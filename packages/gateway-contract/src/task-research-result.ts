import { z } from 'zod';

const id = z.string().min(1).max(120);
export const TaskResearchSourceSchema = z.object({
  id, toolCallId: z.string().min(1), toolName: z.string().min(1),
  excerpt: z.string().min(1).max(2000), url: z.string().url().optional(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/), observedAt: z.number().int().nonnegative(),
});
export const TaskResearchClaimSchema = z.object({
  id, statement: z.string().min(1).max(2000), kind: z.enum(['fact', 'inference', 'recommendation']),
  sourceIds: z.array(id).min(1).max(8),
  support: z.enum(['supported', 'unsupported', 'uncertain', 'unreviewed']),
  note: z.string().max(1000).optional(),
});
export const TaskResearchCheckSchema = z.object({
  criterionIndex: z.number().int().nonnegative(), criterion: z.string().min(1),
  status: z.enum(['passed', 'failed', 'unverified']), claimIds: z.array(id).max(40),
  note: z.string().min(1).max(1000),
});
export const TaskResearchResultSchema = z.object({
  version: z.literal(1), contractVersion: z.number().int().positive(),
  instructionSequence: z.number().int().nonnegative(),
  sources: z.array(TaskResearchSourceSchema).max(40), claims: z.array(TaskResearchClaimSchema).min(1).max(40),
  checks: z.array(TaskResearchCheckSchema).max(40),
  review: z.enum(['model_reviewed', 'unavailable']),
  finalArtifactIds: z.array(z.string().min(1)).max(50).optional(),
  inspectedArtifactIds: z.array(z.string().min(1)).max(50).optional(),
  instructionChecks: z.array(z.object({ sequence: z.number().int().positive(), instruction: z.string().min(1),
    status: z.enum(['passed', 'failed', 'unverified']), claimIds: z.array(id).max(40), note: z.string().min(1).max(1000),
  })).max(40).optional(),
}).superRefine((value, context) => {
  const unique = (ids: (string | number)[], label: string) => {
    if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: `Duplicate ${label}` });
  };
  unique(value.sources.map(item => item.id), 'source IDs'); unique(value.claims.map(item => item.id), 'claim IDs');
  unique(value.checks.map(item => item.criterionIndex), 'criterion indices');
  unique((value.instructionChecks ?? []).map(item => item.sequence), 'instruction sequences');
  const sources = new Set(value.sources.map(item => item.id));
  const claims = new Set(value.claims.map(item => item.id));
  for (const claim of value.claims) if (claim.sourceIds.some(ref => !sources.has(ref))) {
    context.addIssue({ code: 'custom', message: 'Unknown claim source' });
  }
  for (const check of [...value.checks, ...(value.instructionChecks ?? [])]) if (check.claimIds.some(ref => !claims.has(ref))) {
    context.addIssue({ code: 'custom', message: 'Unknown criterion claim' });
  }
});
export type TaskResearchResult = z.infer<typeof TaskResearchResultSchema>;
