import { z } from 'zod';

import { TaskCommandSchema } from './tasks.js';

export const AutomationScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: z.string() }),
  z.object({ kind: z.literal('interval'), everyMs: z.number().positive(), anchorMs: z.number().optional() }),
  z.object({ kind: z.literal('cron'), expr: z.string(), tz: z.string().optional() }),
]);

export const AutomationTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual') }),
  z.object({ kind: z.literal('schedule'), schedule: AutomationScheduleSchema }),
  z.object({ kind: z.literal('webhook'), secretId: z.string().optional() }),
  z.object({
    kind: z.literal('event'),
    eventType: z.string(),
    source: z.string().optional(),
    payloadMatch: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  }),
]);

export const AutomationActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('agent'),
    agentId: z.string().optional(),
    instruction: z.string(),
    workingDirectory: z.string().optional(),
    model: z.string().optional(),
    timeoutSeconds: z.number().positive().optional(),
  }),
  z.object({
    kind: z.literal('workflow'),
    workflowId: z.string(),
    agentId: z.string().optional(),
    input: z.unknown().optional(),
    inputEnvelope: z.unknown().optional(),
    goal: z.string().optional(),
    concurrency: z.number().int().positive().optional(),
    maxSubagents: z.number().int().nonnegative().optional(),
    timeoutSeconds: z.number().positive().optional(),
  }),
  z.object({
    kind: z.literal('browser_recipe'),
    recipeId: z.string(),
    args: z.record(z.string(), z.unknown()).optional(),
    timeoutSeconds: z.number().positive().optional(),
  }),
  z.object({ kind: z.literal('task_command'), taskId: z.string(), command: TaskCommandSchema }),
]);

export const AutomationRunStatusSchema = z.enum([
  'queued',
  'running',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
  'timeout',
]);

export const AutomationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  projectId: z.string().optional(),
  enabled: z.boolean(),
  trigger: AutomationTriggerSchema,
  action: AutomationActionSchema,
  safety: z.object({ mode: z.enum(['suggest_only', 'ask_before_apply', 'auto_apply']) }).optional(),
  afterRun: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('saveToSession') }),
    z.object({ kind: z.literal('webhook'), url: z.string() }),
  ]).optional(),
  reliability: z.object({
    executionTimeoutSeconds: z.number().positive().optional(),
    timeoutSeconds: z.number().positive().optional(),
    retryCount: z.number().int().nonnegative().optional(),
    maxConcurrentRuns: z.number().int().positive().optional(),
    disableAfterConsecutiveFailures: z.number().int().positive().optional(),
  }).optional(),
  state: z.object({
    nextRunAtMs: z.number().optional(),
    runningRunId: z.string().optional(),
    lastRunAtMs: z.number().optional(),
    lastRunStatus: AutomationRunStatusSchema.optional(),
    lastError: z.string().optional(),
    consecutiveFailures: z.number().int().nonnegative().optional(),
  }),
  createdAtMs: z.number(),
  updatedAtMs: z.number(),
});

export const AutomationRunSchema = z.object({
  id: z.string(),
  automationId: z.string(),
  automationName: z.string(),
  status: AutomationRunStatusSchema,
  triggerSnapshot: AutomationTriggerSchema,
  actionSnapshot: AutomationActionSchema,
  manual: z.boolean(),
  createdAtMs: z.number(),
  startedAtMs: z.number().optional(),
  endedAtMs: z.number().optional(),
  durationMs: z.number().optional(),
  summary: z.string().optional(),
  error: z.string().optional(),
  sessionKey: z.string().optional(),
  workflowRunId: z.string().optional(),
  model: z.string().optional(),
  deadlineAtMs: z.number().optional(),
  currentPhase: z.enum(['queued', 'action', 'after_run', 'cancelling', 'completed']).optional(),
  cancelRequestedAtMs: z.number().optional(),
  cancelConfirmedAtMs: z.number().optional(),
  termination: z.object({
    reason: z.enum(['completed', 'failed', 'user_cancelled', 'deadline_exceeded']),
    component: z.enum(['automation', 'agent_turn', 'tool', 'mcp', 'process']).optional(),
    componentName: z.string().optional(),
    cancellationConfirmed: z.boolean(),
  }).optional(),
  heartbeatAtMs: z.number().optional(),
  leaseOwner: z.string().optional(),
  leaseExpiresAtMs: z.number().optional(),
  attemptNumber: z.number().int().positive().optional(),
  rootRunId: z.string().optional(),
});

export const AutomationRunEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  automationId: z.string(),
  type: z.enum([
    'run.queued',
    'run.started',
    'run.deadline_resolved',
    'run.cancel_requested',
    'run.cancel_confirmed',
    'run.cancellation_unconfirmed',
    'run.recovered',
    'action.started',
    'action.retry_scheduled',
    'action.completed',
    'action.failed',
    'after_run.started',
    'after_run.completed',
    'after_run.failed',
    'run.completed',
  ]),
  message: z.string(),
  data: z.unknown().optional(),
  createdAtMs: z.number(),
});

export const AutomationMetricsSchema = z.object({
  totalAutomations: z.number().int().nonnegative(),
  enabledAutomations: z.number().int().nonnegative(),
  runningRuns: z.number().int().nonnegative(),
  failedLastHour: z.number().int().nonnegative(),
  nextRun: z.object({ automationId: z.string(), name: z.string(), runAtMs: z.number() }).optional(),
});

export type Automation = z.infer<typeof AutomationSchema>;
export type AutomationAction = z.infer<typeof AutomationActionSchema>;
export type AutomationMetrics = z.infer<typeof AutomationMetricsSchema>;
export type AutomationRun = z.infer<typeof AutomationRunSchema>;
export type AutomationRunEvent = z.infer<typeof AutomationRunEventSchema>;
export type AutomationRunStatus = z.infer<typeof AutomationRunStatusSchema>;
export type AutomationSchedule = z.infer<typeof AutomationScheduleSchema>;
export type AutomationTrigger = z.infer<typeof AutomationTriggerSchema>;
