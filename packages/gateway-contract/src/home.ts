import { z } from 'zod';

export const HomeDecisionSchema = z.object({
  id: z.string(),
  kind: z.enum(['task', 'connector_approval']),
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
  conversationId: z.string().optional(),
});

export const HomeActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('open'),
    label: z.string(),
    href: z.string(),
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

export const HomeRunningConversationSchema = z.object({
  conversationId: z.string(),
  runId: z.string(),
  title: z.string().optional(),
  agentId: z.string().optional(),
  updatedAt: z.number(),
});

export const HomeEvidenceSchema = z.strictObject({
  id: z.string().trim().min(1).max(300),
  sourceType: z.enum(['project', 'task', 'conversation', 'scene', 'calendar', 'mail', 'communication', 'file', 'user_model']),
  sourceRef: z.string().trim().min(1).max(1_000),
  revision: z.string().trim().min(1).max(300),
  observation: z.string().trim().min(1).max(1_000),
  observedAt: z.number().int().nonnegative(),
  freshUntil: z.number().int().nonnegative(),
  href: z.string().trim().min(1).max(2_000).optional(),
});

export const HomeCapabilityReadinessSchema = z.strictObject({
  kind: z.enum(['connector', 'skill', 'agent']),
  capability: z.string().trim().min(1).max(200),
  resolvedId: z.string().trim().min(1).max(300).optional(),
  readiness: z.enum(['ready', 'needs_setup', 'unavailable']),
  required: z.boolean(),
  recoveryPath: z.string().trim().min(1).max(2_000).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export const HomeCapabilityBlockerSchema = z.strictObject({
  kind: z.enum(['connector', 'skill', 'agent']),
  capability: z.string().trim().min(1).max(200),
  code: z.enum([
    'not_installed', 'disabled', 'agent_not_allowed', 'scope_too_narrow',
    'connection_missing', 'account_selection_required', 'reauthorization_required',
    'requirements_unmet', 'model_invocation_disabled', 'tool_gated', 'agent_unavailable',
  ]),
  message: z.string().trim().min(1).max(500),
  recoveryPath: z.string().trim().min(1).max(2_000),
});

export const HomeCapabilityPreflightSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('ready') }),
  z.strictObject({
    state: z.literal('needs_setup'),
    blockers: z.array(HomeCapabilityBlockerSchema).min(1).max(12),
    recoveryActions: z.array(z.strictObject({
      capability: z.string().trim().min(1).max(200),
      href: z.string().trim().min(1).max(2_000),
    })).min(1).max(12),
    degradedAction: z.strictObject({ mode: z.literal('degraded_start') }).optional(),
  }),
]);

export const HomeOpportunitySchema = z.strictObject({
  id: z.string().trim().min(1).max(200),
  revision: z.number().int().positive(),
  kind: z.enum(['project_next_step', 'delivery_risk', 'meeting_prep', 'commitment_follow_up', 'automation_candidate']),
  projectId: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(160),
  outcome: z.string().trim().min(1).max(1_000),
  rationale: z.string().trim().min(1).max(1_500),
  evidence: z.array(HomeEvidenceSchema).min(1).max(8),
  confidence: z.enum(['high', 'medium', 'low']),
  urgency: z.enum(['now', 'today', 'this_week']),
  estimatedMinutes: z.number().int().min(1).max(480).optional(),
  risk: z.enum(['analysis', 'external_read', 'file_write', 'external_write']),
  proposedSteps: z.array(z.string().trim().min(1).max(500)).min(1).max(6),
  capabilities: z.array(HomeCapabilityReadinessSchema).max(12),
  verification: z.array(z.string().trim().min(1).max(500)).max(8),
  actionPrompt: z.string().trim().min(1).max(4_000),
  degradedActionPrompt: z.string().trim().min(1).max(4_000).optional(),
  continuation: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('scene'),
      reason: z.literal('prior_success'),
      href: z.string().trim().min(1).max(2_000),
    }),
    z.strictObject({
      kind: z.literal('automation'),
      reason: z.literal('repeated_success'),
      href: z.string().trim().min(1).max(4_000),
      successCount: z.number().int().min(2),
    }),
  ]).optional(),
  actions: z.strictObject({
    canStart: z.boolean(),
    canDiscuss: z.boolean(),
    degradedStartAvailable: z.boolean(),
  }),
  generatedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
});

export const HomeClarificationSchema = z.strictObject({
  id: z.string().trim().min(1).max(200),
  revision: z.number().int().positive(),
  question: z.string().trim().min(1).max(500),
  options: z.array(z.strictObject({
    id: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(200),
  })).min(2).max(3),
  evidenceIds: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
});

export const HomeAdvisorSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('disabled') }),
  z.strictObject({ state: z.literal('quiet'), reason: z.enum(['no_change', 'insufficient_value', 'model_unavailable']) }),
  z.strictObject({
    state: z.literal('refreshing'),
    previous: HomeOpportunitySchema.optional(),
    requestedAt: z.number().int().nonnegative(),
  }),
  z.strictObject({
    state: z.literal('clarification'),
    question: HomeClarificationSchema,
    generatedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
  }),
  z.strictObject({
    state: z.literal('ready'),
    primary: HomeOpportunitySchema,
    alternatives: z.array(HomeOpportunitySchema).max(2),
    placement: z.enum(['primary', 'compact']),
    generatedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    stale: z.boolean(),
  }),
]);

export const HomeAdvisorRefreshRequestSchema = z.strictObject({
  idempotencyKey: z.string().trim().min(1).max(200),
  locale: z.string().trim().max(30).optional(),
});

export const HomeOpportunityFeedbackRequestSchema = z.strictObject({
  idempotencyKey: z.string().trim().min(1).max(200),
  expectedRevision: z.number().int().positive(),
  kind: z.enum(['already_done', 'irrelevant', 'too_early', 'source_incorrect', 'less_like_this', 'snoozed']),
  reasonCode: z.string().trim().min(1).max(100).optional(),
  note: z.string().trim().min(1).max(1_000).optional(),
  snoozedUntil: z.number().int().nonnegative().optional(),
});

export const HomeOpportunityActionRequestSchema = z.strictObject({
  idempotencyKey: z.string().trim().min(1).max(200),
  expectedRevision: z.number().int().positive(),
  mode: z.enum(['start', 'degraded_start', 'discuss']),
});

export const HomeOpportunityActionResponseSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('task'), taskId: z.string(), href: z.string() }),
  z.strictObject({ outcome: z.literal('chat_draft'), href: z.string() }),
  z.strictObject({ outcome: z.literal('needs_setup'), preflight: HomeCapabilityPreflightSchema }),
]);

export const HomeResponseSchema = z.object({
  runningConversations: z.array(HomeRunningConversationSchema).default([]),
  needsUser: z.array(HomeWorkbenchItemSchema),
  background: z.array(HomeWorkbenchItemSchema),
  backgroundCount: z.number().int().nonnegative(),
  decisions: z.array(HomeDecisionSchema),
  advisor: HomeAdvisorSchema,
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

export const HomeAdviceMetricsSchema = z.strictObject({
  window: z.strictObject({ since: z.number().int().nonnegative(), until: z.number().int().nonnegative() }),
  currentStrategyVersion: z.string().trim().min(1).max(100),
  generations: z.strictObject({
    total: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    quiet: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative(),
  }),
  outcomes: z.strictObject({
    opportunities: z.number().int().nonnegative(),
    started: z.number().int().nonnegative(),
    discussed: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    corrected: z.number().int().nonnegative(),
    expired: z.number().int().nonnegative(),
  }),
  rates: z.strictObject({
    start: z.number().min(0).max(1),
    completionFromStarted: z.number().min(0).max(1),
    correction: z.number().min(0).max(1),
  }),
  feedback: z.strictObject({
    alreadyDone: z.number().int().nonnegative(),
    irrelevant: z.number().int().nonnegative(),
    tooEarly: z.number().int().nonnegative(),
    sourceIncorrect: z.number().int().nonnegative(),
    lessLikeThis: z.number().int().nonnegative(),
  }),
  strategies: z.array(z.strictObject({
    version: z.string().trim().min(1).max(100),
    generations: z.number().int().nonnegative(),
    opportunities: z.number().int().nonnegative(),
    started: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
  })),
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
export type HomeRunningConversation = z.infer<typeof HomeRunningConversationSchema>;
export type HomeEvidence = z.infer<typeof HomeEvidenceSchema>;
export type HomeCapabilityReadiness = z.infer<typeof HomeCapabilityReadinessSchema>;
export type HomeCapabilityBlocker = z.infer<typeof HomeCapabilityBlockerSchema>;
export type HomeCapabilityPreflight = z.infer<typeof HomeCapabilityPreflightSchema>;
export type HomeOpportunity = z.infer<typeof HomeOpportunitySchema>;
export type HomeClarification = z.infer<typeof HomeClarificationSchema>;
export type HomeAdvisor = z.infer<typeof HomeAdvisorSchema>;
export type HomeAdvisorRefreshRequest = z.infer<typeof HomeAdvisorRefreshRequestSchema>;
export type HomeOpportunityFeedbackRequest = z.infer<typeof HomeOpportunityFeedbackRequestSchema>;
export type HomeOpportunityActionRequest = z.infer<typeof HomeOpportunityActionRequestSchema>;
export type HomeOpportunityActionResponse = z.infer<typeof HomeOpportunityActionResponseSchema>;
export type HomeResponse = z.infer<typeof HomeResponseSchema>;
export type HomeAdviceMetrics = z.infer<typeof HomeAdviceMetricsSchema>;
export type TaskValueMetrics = z.infer<typeof TaskValueMetricsSchema>;

export function parseHomeResponse(value: unknown): HomeResponse {
  return HomeResponseSchema.parse(value);
}
