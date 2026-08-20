import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';
import { TaskCommandSchema } from '@xopcai/gateway-contract';

const nonEmptyString = z.string().trim().min(1);

const optionalTrimmedString = (max: number) =>
  z.preprocess((value) => {
    if (value == null) return undefined;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }, z.string().min(1).max(max).optional());

export const AutomationScheduleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('once'),
    at: nonEmptyString,
  }).strict(),
  z.object({
    kind: z.literal('interval'),
    everyMs: z.number().int().min(1),
    anchorMs: z.number().int().nonnegative().optional(),
  }).strict(),
  z.object({
    kind: z.literal('cron'),
    expr: nonEmptyString.superRefine((expr, ctx) => {
      try {
        CronExpressionParser.parse(expr);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid cron expression: ${expr}`,
        });
      }
    }),
    tz: optionalTrimmedString(100),
  }).strict(),
]);

export const AutomationTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual') }).strict(),
  z.object({
    kind: z.literal('schedule'),
    schedule: AutomationScheduleSchema,
  }).strict(),
  z.object({
    kind: z.literal('webhook'),
    secretId: optionalTrimmedString(200),
  }).strict(),
  z.object({
    kind: z.literal('event'),
    eventType: nonEmptyString.max(200),
    source: optionalTrimmedString(200),
    payloadMatch: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    ).optional(),
  }).strict(),
]);

const WorkflowRunInputEnvelopeSchema = z.object({
  payload: z.unknown(),
  goal: optionalTrimmedString(5000),
  variables: z.record(z.string(), z.unknown()).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const AutomationActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('agent'),
    agentId: optionalTrimmedString(64),
    instruction: nonEmptyString.max(50000),
    workingDirectory: optionalTrimmedString(4096),
    model: optionalTrimmedString(100),
    timeoutSeconds: z.number().int().min(1).max(86400).optional(),
  }).strict(),
  z.object({
    kind: z.literal('workflow'),
    workflowId: nonEmptyString.max(200),
    agentId: optionalTrimmedString(64),
    input: z.unknown().optional(),
    inputEnvelope: WorkflowRunInputEnvelopeSchema.optional(),
    goal: optionalTrimmedString(5000),
    concurrency: z.number().int().min(1).max(50).optional(),
    maxSubagents: z.number().int().min(1).max(100).optional(),
    timeoutSeconds: z.number().int().min(1).max(86400).optional(),
  }).strict(),
  z.object({
    kind: z.literal('browser_recipe'),
    recipeId: nonEmptyString.max(100),
    args: z.record(z.string(), z.unknown()).optional(),
    timeoutSeconds: z.number().int().min(1).max(86400).optional(),
  }).strict(),
  z.object({
    kind: z.literal('task_command'),
    taskId: nonEmptyString.max(200),
    command: TaskCommandSchema,
  }).strict(),
]);

export const AutomationAfterRunSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('saveToSession') }).strict(),
  z.object({
    kind: z.literal('webhook'),
    url: nonEmptyString.max(2000),
  }).strict(),
]);

export const AutomationReliabilitySchema = z.object({
  executionTimeoutSeconds: z.number().int().min(1).max(86400).optional(),
  timeoutSeconds: z.number().int().min(1).max(86400).optional(),
  retryCount: z.number().int().min(0).max(10).optional(),
  maxConcurrentRuns: z.number().int().min(1).max(20).optional(),
  disableAfterConsecutiveFailures: z.number().int().min(1).max(100).optional(),
}).strict();

export const AutomationSafetyPolicySchema = z.object({
  mode: z.enum(['suggest_only', 'ask_before_apply', 'auto_apply']),
}).strict();

export const AutomationStateSchema = z.object({
  nextRunAtMs: z.number().int().nonnegative().optional(),
  runningRunId: optionalTrimmedString(100),
  lastRunAtMs: z.number().int().nonnegative().optional(),
  lastRunStatus: z.enum(['queued', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled', 'timeout']).optional(),
  lastError: z.string().optional(),
  consecutiveFailures: z.number().int().nonnegative().optional(),
}).strict();

export const AutomationSchema = z.object({
  id: nonEmptyString.max(100),
  name: nonEmptyString.max(200),
  description: z.string().max(2000).optional(),
  projectId: optionalTrimmedString(100),
  enabled: z.boolean(),
  trigger: AutomationTriggerSchema,
  action: AutomationActionSchema,
  safety: AutomationSafetyPolicySchema.optional(),
  afterRun: AutomationAfterRunSchema.optional(),
  reliability: AutomationReliabilitySchema.optional(),
  state: AutomationStateSchema.default({}),
  createdAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(),
}).strict();

export const CreateAutomationSchema = AutomationSchema.omit({
  id: true,
  enabled: true,
  state: true,
  createdAtMs: true,
  updatedAtMs: true,
}).extend({
  id: optionalTrimmedString(100),
  enabled: z.boolean().optional(),
  state: AutomationStateSchema.partial().optional(),
});

export const UpdateAutomationSchema = AutomationSchema.omit({
  id: true,
  createdAtMs: true,
  updatedAtMs: true,
}).partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided' },
);

export type CreateAutomationInput = z.infer<typeof CreateAutomationSchema>;
export type UpdateAutomationInput = z.infer<typeof UpdateAutomationSchema>;
