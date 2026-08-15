import { z } from 'zod';

export const OutcomeReceiptStatusSchema = z.enum([
  'running',
  'completed',
  'partial',
  'needs_user',
  'failed',
  'cancelled',
]);

export const OutcomeEvidenceSchema = z.object({
  kind: z.enum(['artifact', 'test', 'state', 'source']),
  title: z.string(),
  summary: z.string(),
  uri: z.string().optional(),
  verifies: z.array(z.string()).optional(),
});

export const OutcomeReceiptSchema = z.object({
  runId: z.string(),
  sessionKey: z.string(),
  objective: z.string(),
  status: OutcomeReceiptStatusSchema,
  summary: z.string(),
  projectId: z.string().optional(),
  goalId: z.string().optional(),
  workItemId: z.string().optional(),
  origin: z.string().optional(),
  triggerKind: z.string().optional(),
  changes: z.array(OutcomeEvidenceSchema),
  evidence: z.array(OutcomeEvidenceSchema),
  verification: z.object({
    status: z.enum(['passed', 'failed', 'unverified']),
    checks: z.array(z.object({
      criterion: z.string(),
      status: z.enum(['passed', 'failed', 'unverified']),
      evidenceTitles: z.array(z.string()),
    })),
  }),
  remainingWork: z.array(z.string()),
  nextAction: z.string().optional(),
  needsUser: z.boolean(),
  contextTraceId: z.string().optional(),
  startedAt: z.number(),
  completedAt: z.number().optional(),
  feedback: z.object({
    outcome: z.enum(['helpful', 'not_helpful']),
    reason: z.string().optional(),
    needsCorrection: z.boolean().optional(),
    supportFit: z.boolean().optional(),
  }).optional(),
});

export const OutcomeReceiptListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(OutcomeReceiptSchema),
});

export type OutcomeReceiptStatus = z.infer<typeof OutcomeReceiptStatusSchema>;
export type OutcomeEvidence = z.infer<typeof OutcomeEvidenceSchema>;
export type OutcomeReceipt = z.infer<typeof OutcomeReceiptSchema>;
export type OutcomeReceiptListResponse = z.infer<typeof OutcomeReceiptListResponseSchema>;

export function parseOutcomeReceipt(value: unknown): OutcomeReceipt {
  return OutcomeReceiptSchema.parse(value);
}
