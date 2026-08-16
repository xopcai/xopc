import { z } from 'zod';

import { OutcomeReceiptSchema } from './outcomes.js';

export const WorkItemStatusSchema = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'needs_input',
  'in_review',
  'done',
  'cancelled',
]);

export const WorkItemPrioritySchema = z.enum(['urgent', 'high', 'normal', 'low']);

export const WorkHomeItemSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  title: z.string(),
  status: WorkItemStatusSchema,
  priority: WorkItemPrioritySchema,
  nextAction: z.string().optional(),
  blockedReason: z.string().optional(),
  dueAt: z.number().optional(),
  completedAt: z.number().optional(),
  updatedAt: z.number(),
});

export const WorkHomeDecisionSchema = z.object({
  id: z.string(),
  kind: z.enum(['agent_judgment', 'work_item', 'goal', 'connector_approval', 'goal_evidence']),
  title: z.string(),
  detail: z.string().optional(),
  reason: z.enum([
    'needs_input',
    'in_review',
    'blocked',
    'overdue',
    'due_soon',
    'decision_needed',
    'approval_required',
  ]),
  urgency: z.enum(['now', 'soon']),
  href: z.string(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  updatedAt: z.number(),
  judgment: z.object({
    inboxItemId: z.string(),
    whyNow: z.string(),
    impact: z.string(),
    workDone: z.string(),
    recommendation: z.string(),
    confidence: z.number(),
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
    z.object({ kind: z.literal('goal_evidence'), goalId: z.string(), requirementId: z.string() }),
  ]).optional(),
});

export const WorkHomeAttentionSchema = z.object({
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

export const WorkHomeAutomationSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  trigger: z.string(),
  action: z.string(),
  nextRunAt: z.string(),
});

export const WorkHomeWorkflowRunSchema = z.object({
  id: z.string(),
  definitionId: z.string(),
  title: z.string(),
  status: z.string(),
  sessionKey: z.string().optional(),
  createdAtMs: z.number(),
  startedAtMs: z.number().optional(),
  completedAtMs: z.number().optional(),
});

export const WorkHomeChatSchema = z.object({
  key: z.string(),
  name: z.string(),
  updatedAt: z.string().optional(),
  active: z.boolean(),
});

export const WorkHomeBriefingWinSchema = z.object({
  id: z.string(),
  kind: z.enum(['work_item', 'workflow_run', 'automation_run']),
  title: z.string(),
  href: z.string(),
  completedAt: z.number(),
});

export const WorkHomeResponseSchema = z.object({
  briefing: z.object({
    generatedAt: z.number(),
    summary: z.string(),
    focus: z.array(WorkHomeDecisionSchema),
    progress: z.object({
      activeWorkCount: z.number(),
      activeWorkflowCount: z.number(),
      activeGoalCount: z.number(),
      movingCount: z.number(),
    }),
    wins: z.array(WorkHomeBriefingWinSchema),
    nextScheduled: WorkHomeAutomationSchema.optional(),
  }),
  decisions: z.array(WorkHomeDecisionSchema),
  attention: z.array(WorkHomeAttentionSchema),
  chats: z.object({
    running: z.array(WorkHomeChatSchema),
    recent: z.array(WorkHomeChatSchema),
  }),
  work: z.object({
    attentionCount: z.number(),
    overdueCount: z.number(),
    todayCount: z.number(),
    items: z.array(WorkHomeItemSchema),
    current: z.array(WorkHomeItemSchema),
    recentlyCompleted: z.array(WorkHomeItemSchema),
  }),
  workflowRuns: z.object({
    active: z.array(WorkHomeWorkflowRunSchema),
    recent: z.array(WorkHomeWorkflowRunSchema),
  }),
  upcomingAutomations: z.array(WorkHomeAutomationSchema),
  recentOutcomes: z.array(OutcomeReceiptSchema).default([]),
}).passthrough();

export const WorkValueMetricsSchema = z.object({
  intake: z.object({
    total: z.number(),
    proposed: z.number(),
    confirmed: z.number(),
    expired: z.number(),
    runNow: z.number(),
    createOnly: z.number(),
    queued: z.number(),
    pendingQueueRecovery: z.number(),
    confirmationRate: z.number(),
    queueRate: z.number(),
  }),
  outcomes: z.object({
    total: z.number(),
    achieved: z.number(),
    partial: z.number(),
    notAchieved: z.number(),
    userCorrected: z.number(),
    achievementRate: z.number(),
    correctionRate: z.number(),
  }),
});

export type WorkHomeItem = z.infer<typeof WorkHomeItemSchema>;
export type WorkHomeDecision = z.infer<typeof WorkHomeDecisionSchema>;
export type WorkHomeAttention = z.infer<typeof WorkHomeAttentionSchema>;
export type WorkHomeAutomation = z.infer<typeof WorkHomeAutomationSchema>;
export type WorkHomeWorkflowRun = z.infer<typeof WorkHomeWorkflowRunSchema>;
export type WorkHomeChat = z.infer<typeof WorkHomeChatSchema>;
export type WorkHomeBriefingWin = z.infer<typeof WorkHomeBriefingWinSchema>;
export type WorkHomeResponse = z.infer<typeof WorkHomeResponseSchema>;
export type WorkValueMetrics = z.infer<typeof WorkValueMetricsSchema>;

export function parseWorkHomeResponse(value: unknown): WorkHomeResponse {
  return WorkHomeResponseSchema.parse(value);
}
