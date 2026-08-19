import { z } from 'zod';

import { OutcomeReceiptSchema, OutcomeSchema } from './outcomes.js';

export const WorkItemPhaseSchema = z.enum([
  'backlog',
  'ready',
  'executing',
  'verifying',
  'closed',
]);

export const WorkItemPrioritySchema = z.enum(['urgent', 'high', 'normal', 'low']);

export const WorkItemResolutionSchema = z.enum([
  'completed',
  'cancelled',
  'duplicate',
  'superseded',
  'expired',
  'not_feasible',
]);

export const WorkItemCompletionPolicySchema = z.enum([
  'automatic',
  'agent_verified',
  'user_accepted',
]);

export const WorkItemActionActorSchema = z.enum(['agent', 'user', 'external', 'system']);

export const WorkItemNextActionSchema = z.object({
  text: z.string().trim().min(1),
  actor: WorkItemActionActorSchema,
  dueAt: z.number().optional(),
});

export const WorkItemWaitKindSchema = z.enum([
  'user_input',
  'user_approval',
  'dependency',
  'external',
  'scheduled',
  'retry',
  'paused',
]);

export const WorkItemWaitSchema = z.object({
  id: z.string(),
  workItemId: z.string(),
  kind: WorkItemWaitKindSchema,
  reason: z.string(),
  resumeAt: z.number().optional(),
  blockingWorkItemId: z.string().optional(),
  createdAt: z.number(),
  resolvedAt: z.number().optional(),
  resolutionNote: z.string().optional(),
});

export const WorkItemLinkSchema = z.object({
  id: z.string(),
  workItemId: z.string(),
  kind: z.enum(['chat', 'outcome', 'workflow_run', 'automation', 'note']),
  targetId: z.string(),
  title: z.string().optional(),
  statusSnapshot: z.string().optional(),
  createdAt: z.number(),
});

export const WorkItemAttachmentSchema = z.object({
  id: z.string(),
  workItemId: z.string(),
  mediaUri: z.string(),
  mediaId: z.string(),
  bucket: z.string(),
  type: z.enum(['image', 'audio', 'video', 'file']),
  mimeType: z.string(),
  fileName: z.string(),
  size: z.number(),
  createdAt: z.number(),
});

export const WorkItemSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  priority: WorkItemPrioritySchema,
  ownerAgentId: z.string().optional(),
  phase: WorkItemPhaseSchema,
  completionPolicy: WorkItemCompletionPolicySchema,
  nextAction: WorkItemNextActionSchema.optional(),
  waits: z.array(WorkItemWaitSchema),
  links: z.array(WorkItemLinkSchema),
  attachments: z.array(WorkItemAttachmentSchema),
  resolution: WorkItemResolutionSchema.optional(),
  resolutionReason: z.string().optional(),
  dueAt: z.number().optional(),
  startedAt: z.number().optional(),
  reviewRequestedAt: z.number().optional(),
  closedAt: z.number().optional(),
  archivedAt: z.number().optional(),
  version: z.number().int().positive(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const ExpectedVersionSchema = z.number().int().positive();

export const WorkItemCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('commit'), expectedVersion: ExpectedVersionSchema }),
  z.object({ type: z.literal('defer'), expectedVersion: ExpectedVersionSchema, reason: z.string().trim().min(1).optional() }),
  z.object({ type: z.literal('start'), expectedVersion: ExpectedVersionSchema, nextAction: WorkItemNextActionSchema.optional() }),
  z.object({ type: z.literal('stop'), expectedVersion: ExpectedVersionSchema, reason: z.string().trim().min(1).optional() }),
  z.object({ type: z.literal('request_review'), expectedVersion: ExpectedVersionSchema, summary: z.string().trim().min(1) }),
  z.object({ type: z.literal('request_changes'), expectedVersion: ExpectedVersionSchema, reason: z.string().trim().min(1), nextAction: WorkItemNextActionSchema }),
  z.object({ type: z.literal('complete'), expectedVersion: ExpectedVersionSchema, summary: z.string().trim().min(1).optional() }),
  z.object({ type: z.literal('accept'), expectedVersion: ExpectedVersionSchema, note: z.string().trim().min(1).optional() }),
  z.object({
    type: z.literal('close'),
    expectedVersion: ExpectedVersionSchema,
    resolution: z.enum(['cancelled', 'duplicate', 'superseded', 'expired', 'not_feasible']),
    reason: z.string().trim().min(1).optional(),
  }),
  z.object({ type: z.literal('reopen'), expectedVersion: ExpectedVersionSchema, reason: z.string().trim().min(1).optional() }),
  z.object({
    type: z.literal('wait'),
    expectedVersion: ExpectedVersionSchema,
    wait: z.object({
      kind: WorkItemWaitKindSchema,
      reason: z.string().trim().min(1),
      resumeAt: z.number().optional(),
      blockingWorkItemId: z.string().trim().min(1).optional(),
    }),
  }),
  z.object({ type: z.literal('resume'), expectedVersion: ExpectedVersionSchema, waitId: z.string().trim().min(1), note: z.string().trim().min(1).optional() }),
]);

export const WorkItemCommandProposalSchema = z.object({
  id: z.string(),
  workItemId: z.string(),
  command: WorkItemCommandSchema,
  sourceKind: z.enum(['chat', 'workflow_run', 'automation']),
  sourceId: z.string(),
  rationale: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  state: z.enum(['pending', 'executed', 'rejected', 'expired']),
  createdAt: z.number(),
  resolvedAt: z.number().optional(),
});

export const WorkHomeItemSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  title: z.string(),
  phase: WorkItemPhaseSchema,
  priority: WorkItemPrioritySchema,
  completionPolicy: WorkItemCompletionPolicySchema,
  nextAction: WorkItemNextActionSchema.optional(),
  waits: z.array(WorkItemWaitSchema),
  resolution: WorkItemResolutionSchema.optional(),
  dueAt: z.number().optional(),
  closedAt: z.number().optional(),
  updatedAt: z.number(),
});

export const WorkHomeDecisionSchema = z.object({
  id: z.string(),
  kind: z.enum(['agent_judgment', 'work_item', 'outcome', 'connector_approval']),
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
      activeOutcomeCount: z.number(),
      movingCount: z.number(),
    }),
    wins: z.array(WorkHomeBriefingWinSchema),
    nextScheduled: WorkHomeAutomationSchema.optional(),
  }),
  decisions: z.array(WorkHomeDecisionSchema),
  attention: z.array(WorkHomeAttentionSchema),
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
  outcomes: z.object({
    running: z.array(OutcomeSchema),
    needsUser: z.array(OutcomeSchema),
    recentlyCompleted: z.array(OutcomeSchema),
  }).default({ running: [], needsUser: [], recentlyCompleted: [] }),
  recentOutcomes: z.array(OutcomeReceiptSchema).default([]),
}).passthrough();

export const WorkValueMetricsSchema = z.object({
  northStar: z.object({
    weeklyTrustedProgress: z.number(),
    weeklyActiveUsers: z.number(),
    trustedProgressPerWeeklyActiveUser: z.number(),
  }),
  outcomes: z.object({
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

export type WorkHomeItem = z.infer<typeof WorkHomeItemSchema>;
export type WorkItem = z.infer<typeof WorkItemSchema>;
export type WorkItemPhase = z.infer<typeof WorkItemPhaseSchema>;
export type WorkItemPriority = z.infer<typeof WorkItemPrioritySchema>;
export type WorkItemResolution = z.infer<typeof WorkItemResolutionSchema>;
export type WorkItemCompletionPolicy = z.infer<typeof WorkItemCompletionPolicySchema>;
export type WorkItemActionActor = z.infer<typeof WorkItemActionActorSchema>;
export type WorkItemNextAction = z.infer<typeof WorkItemNextActionSchema>;
export type WorkItemWaitKind = z.infer<typeof WorkItemWaitKindSchema>;
export type WorkItemWait = z.infer<typeof WorkItemWaitSchema>;
export type WorkItemLink = z.infer<typeof WorkItemLinkSchema>;
export type WorkItemAttachment = z.infer<typeof WorkItemAttachmentSchema>;
export type WorkItemCommand = z.infer<typeof WorkItemCommandSchema>;
export type WorkItemCommandProposal = z.infer<typeof WorkItemCommandProposalSchema>;
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
