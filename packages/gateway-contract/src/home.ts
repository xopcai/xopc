import { z } from 'zod';

export const HomeDecisionSchema = z.object({
  id: z.string(),
  kind: z.enum(['agent_judgment', 'task', 'connector_approval']),
  title: z.string(),
  detail: z.string().optional(),
  reason: z.enum([
    'needs_input',
    'blocked',
    'user_input',
    'user_approval',
    'dependency',
    'external',
    'scheduled',
    'retry',
    'paused',
    'overdue',
    'due_soon',
    'decision_needed',
    'approval_required',
  ]),
  urgency: z.enum(['now', 'soon']),
  href: z.string(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  dueAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number(),
  judgment: z.object({
    inboxItemId: z.string(),
    whyNow: z.string(),
    impact: z.string(),
    workDone: z.string(),
    recommendation: z.string(),
    confidence: z.number(),
    valueScore: z.number().min(0).max(1).optional(),
    disposition: z.enum(['show_in_work', 'request_approval', 'auto_execute']).optional(),
    dispositionReason: z.string().optional(),
    actionStatus: z.enum(['not_authorized', 'approval_required', 'pending', 'executing', 'completed', 'rejected', 'failed']).optional(),
    proposedActionTitle: z.string().optional(),
    actionError: z.string().optional(),
    decision: z.object({
      question: z.string(),
      options: z.array(z.object({
        id: z.string(),
        label: z.string(),
        consequence: z.string(),
      })),
    }).optional(),
  }).optional(),
  response: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('connector_approval'), approvalId: z.string() }),
  ]).optional(),
});

export const HomeAttentionSchema = z.object({
  id: z.string(),
  kind: z.enum(['automation_run', 'workflow_run']),
  runId: z.string(),
  title: z.string(),
  detail: z.string(),
  reason: z.enum(['run_failed', 'run_timeout']),
  href: z.string(),
  updatedAt: z.number(),
  sessionKey: z.string().optional(),
});

export const HomeActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('open'),
    label: z.string(),
    href: z.string(),
  }),
  z.object({
    type: z.literal('review_judgment'),
    label: z.string(),
    itemId: z.string(),
  }),
  z.object({
    type: z.literal('connector_decision'),
    label: z.string(),
    approvalId: z.string(),
    decision: z.enum(['approve', 'deny']),
  }),
  z.object({
    type: z.literal('retry_run'),
    label: z.string(),
    subjectKind: z.enum(['automation_run', 'workflow_run']),
    runId: z.string(),
  }),
  z.object({
    type: z.literal('acknowledge_run'),
    label: z.string(),
    subjectKind: z.enum(['automation_run', 'workflow_run']),
    runId: z.string(),
  }),
]);

export const HomeWorkbenchItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['decision', 'failure', 'running', 'scheduled']),
  title: z.string(),
  summary: z.string(),
  recommendation: z.string().optional(),
  dueAt: z.number().int().nonnegative().optional(),
  statusLabel: z.string().optional(),
  updatedAt: z.number(),
  openAction: HomeActionSchema.optional(),
  primaryAction: HomeActionSchema.optional(),
  secondaryActions: z.array(HomeActionSchema).max(2).default([]),
});

export const HomeResponseSchema = z.object({
  needsUser: z.array(HomeWorkbenchItemSchema),
  background: z.array(HomeWorkbenchItemSchema),
  backgroundCount: z.number().int().nonnegative(),
  decisions: z.array(HomeDecisionSchema),
  attentionPolicy: z.object({
    visibleDecisionCount: z.number().int().nonnegative(),
    suppressedDecisionCount: z.number().int().nonnegative(),
    visibleAttentionCount: z.number().int().nonnegative(),
    suppressedAttentionCount: z.number().int().nonnegative(),
  }).default({
    visibleDecisionCount: 0,
    suppressedDecisionCount: 0,
    visibleAttentionCount: 0,
    suppressedAttentionCount: 0,
  }),
});

export const TaskValueMetricsSchema = z.object({
  northStar: z.object({
    weeklyTrustedProgress: z.number(),
    weeklyActiveUsers: z.number(),
    trustedProgressPerWeeklyActiveUser: z.number(),
  }),
  tasks: z.object({
    total: z.number(),
    achieved: z.number(),
    partial: z.number(),
    notAchieved: z.number(),
    userCorrected: z.number(),
    achievementRate: z.number(),
    correctionRate: z.number(),
    trusted: z.number(),
    trustedRate: z.number(),
  }),
});

export type HomeDecision = z.infer<typeof HomeDecisionSchema>;
export type HomeAttention = z.infer<typeof HomeAttentionSchema>;
export type HomeAction = z.infer<typeof HomeActionSchema>;
export type HomeWorkbenchItem = z.infer<typeof HomeWorkbenchItemSchema>;
export type HomeResponse = z.infer<typeof HomeResponseSchema>;
export type TaskValueMetrics = z.infer<typeof TaskValueMetricsSchema>;

export function parseHomeResponse(value: unknown): HomeResponse {
  return HomeResponseSchema.parse(value);
}
