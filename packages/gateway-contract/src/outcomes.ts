import { z } from 'zod';

export const OutcomeUserStatusSchema = z.enum(['running', 'needs_user', 'completed']);

export const OutcomeInternalStatusSchema = z.enum([
  'captured',
  'planning',
  'running',
  'verifying',
  'continuing',
  'needs_user',
  'blocked',
  'paused',
  'completed',
  'cancelled',
]);

export const OutcomeImportanceSchema = z.enum(['low', 'normal', 'high', 'critical']);

export const OutcomeContractSchema = z.object({
  outcomeId: z.string(),
  version: z.number().int().positive(),
  objective: z.string(),
  deliverables: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  constraints: z.array(z.string()),
  approvalRequired: z.array(z.string()),
  assumptions: z.array(z.string()),
  risks: z.array(z.string()),
  contextSnapshotId: z.string().optional(),
  createdBy: z.enum(['user', 'system']),
  createdAt: z.number(),
});

export const OutcomeSchema = z.object({
  id: z.string(),
  objective: z.string(),
  userStatus: OutcomeUserStatusSchema,
  internalStatus: OutcomeInternalStatusSchema,
  importance: OutcomeImportanceSchema,
  dueAt: z.number().optional(),
  latestContractVersion: z.number().int().positive(),
  latestReceiptRunId: z.string().optional(),
  contract: OutcomeContractSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const OutcomeListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(OutcomeSchema),
});

export const OutcomeActionSchema = z.enum(['run', 'pause', 'resume', 'cancel']);
export const OutcomeActionRequestSchema = z.object({ action: OutcomeActionSchema });

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
  provenance: z.enum(['tool', 'external', 'user', 'judge']),
  strength: z.enum(['observed', 'verified']),
  observedAt: z.number(),
});

export const OutcomeReceiptSchema = z.object({
  runId: z.string(),
  outcomeId: z.string().optional(),
  contractVersion: z.number().int().positive().optional(),
  sessionKey: z.string(),
  objective: z.string(),
  status: OutcomeReceiptStatusSchema,
  summary: z.string(),
  projectId: z.string().optional(),
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
  completionVerdict: z.enum(['achieved', 'partial', 'not_achieved']).optional(),
  correctionText: z.string().optional(),
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
export type OutcomeUserStatus = z.infer<typeof OutcomeUserStatusSchema>;
export type OutcomeInternalStatus = z.infer<typeof OutcomeInternalStatusSchema>;
export type OutcomeImportance = z.infer<typeof OutcomeImportanceSchema>;
export type OutcomeContract = z.infer<typeof OutcomeContractSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;
export type OutcomeListResponse = z.infer<typeof OutcomeListResponseSchema>;
export type OutcomeAction = z.infer<typeof OutcomeActionSchema>;
export type OutcomeEvidence = z.infer<typeof OutcomeEvidenceSchema>;
export type OutcomeReceipt = z.infer<typeof OutcomeReceiptSchema>;
export type OutcomeReceiptListResponse = z.infer<typeof OutcomeReceiptListResponseSchema>;

export function parseOutcomeReceipt(value: unknown): OutcomeReceipt {
  return OutcomeReceiptSchema.parse(value);
}
