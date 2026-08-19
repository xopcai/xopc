import { z } from 'zod';

import { TaskReceiptSchema, TaskSchema } from './tasks.js';

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
  updatedAt: z.number(),
  judgment: z.object({
    inboxItemId: z.string(),
    whyNow: z.string(),
    impact: z.string(),
    workDone: z.string(),
    recommendation: z.string(),
    confidence: z.number(),
    valueScore: z.number().min(0).max(1).optional(),
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

export const HomeAutomationSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  trigger: z.string(),
  action: z.string(),
  nextRunAt: z.string(),
});

export const HomeWorkflowRunSchema = z.object({
  id: z.string(),
  definitionId: z.string(),
  title: z.string(),
  status: z.string(),
  sessionKey: z.string().optional(),
  createdAtMs: z.number(),
  startedAtMs: z.number().optional(),
  completedAtMs: z.number().optional(),
});

export const HomeChatSchema = z.object({
  key: z.string(),
  name: z.string(),
  updatedAt: z.string().optional(),
  active: z.boolean(),
});

export const HomeBriefingWinSchema = z.object({
  id: z.string(),
  kind: z.enum(['task', 'workflow_run', 'automation_run']),
  title: z.string(),
  href: z.string(),
  completedAt: z.number(),
});

export const HomeResponseSchema = z.object({
  briefing: z.object({
    generatedAt: z.number(),
    summary: z.string(),
    focus: z.array(HomeDecisionSchema),
    progress: z.object({
      activeWorkflowCount: z.number(),
      activeTaskCount: z.number(),
      movingCount: z.number(),
    }),
    wins: z.array(HomeBriefingWinSchema),
    nextScheduled: HomeAutomationSchema.optional(),
  }),
  decisions: z.array(HomeDecisionSchema),
  attention: z.array(HomeAttentionSchema),
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
  chats: z.object({
    running: z.array(HomeChatSchema),
    recent: z.array(HomeChatSchema),
  }),
  workflowRuns: z.object({
    active: z.array(HomeWorkflowRunSchema),
    recent: z.array(HomeWorkflowRunSchema),
  }),
  upcomingAutomations: z.array(HomeAutomationSchema),
  tasks: z.object({
    running: z.array(TaskSchema),
  }).default({ running: [] }),
  recentTasks: z.array(TaskReceiptSchema).default([]),
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
export type HomeAutomation = z.infer<typeof HomeAutomationSchema>;
export type HomeWorkflowRun = z.infer<typeof HomeWorkflowRunSchema>;
export type HomeChat = z.infer<typeof HomeChatSchema>;
export type HomeBriefingWin = z.infer<typeof HomeBriefingWinSchema>;
export type HomeResponse = z.infer<typeof HomeResponseSchema>;
export type TaskValueMetrics = z.infer<typeof TaskValueMetricsSchema>;

export function parseHomeResponse(value: unknown): HomeResponse {
  return HomeResponseSchema.parse(value);
}
