import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';
import { TaskCommandSchema } from '@xopcai/gateway-contract';

const nonEmptyString = z.string().trim().min(1);

const optionalTrimmedString = (max: number) =>
  z.string().trim().max(max).nullish().transform(value => value || undefined);

const httpsUrl = z.string().trim().min(1).max(2000).transform((value, ctx) => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') throw new Error('unsupported protocol');
    return parsed.toString();
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Webhook endpoint must be a valid HTTPS URL' });
    return z.NEVER;
  }
});

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
    kind: z.literal('browser_automation'),
    automationId: nonEmptyString.max(100),
    inputs: z.record(z.string(), z.unknown()).optional(),
    timeoutSeconds: z.number().int().min(1).max(86400).optional(),
  }).strict(),
  z.object({
    kind: z.literal('task_command'),
    taskId: nonEmptyString.max(200),
    command: TaskCommandSchema,
  }).strict(),
  z.object({
    kind: z.literal('system'),
    capability: z.enum([
      'home.advisor.refresh',
      'memory.temporal_sweep',
      'memory.daily_reconciliation',
      'memory.weekly_knowledge',
    ]),
  }).strict(),
]);

export const AutomationManagementSchema = z.object({
  owner: nonEmptyString.max(100),
  editable: z.array(z.enum(['enabled', 'trigger'])).max(2),
  runnable: z.boolean(),
  deletable: z.boolean(),
}).strict();

export const AutomationReliabilitySchema = z.object({
  executionTimeoutSeconds: z.number().int().min(1).max(86400).optional(),
  retryCount: z.number().int().min(0).max(10).optional(),
  maxConcurrentRuns: z.number().int().min(1).max(20).optional(),
  disableAfterConsecutiveFailures: z.number().int().min(1).max(100).optional(),
}).strict();

export const AutomationSafetyPolicySchema = z.object({
  mode: z.enum(['suggest_only', 'ask_before_apply', 'auto_apply']),
}).strict();

export const AutomationDeliveryPolicySchema = z.object({
  notificationPolicy: z.enum(['attention', 'all', 'none']).default('attention'),
  destinations: z.array(z.discriminatedUnion('kind', [
    z.object({ key: nonEmptyString.max(100), kind: z.literal('gateway_event') }).strict(),
    z.object({
      key: nonEmptyString.max(100), kind: z.literal('webhook'), endpoint: httpsUrl,
      secretId: nonEmptyString.max(200),
    }).strict(),
    z.object({
      key: nonEmptyString.max(100), kind: z.literal('file'), targetId: nonEmptyString.max(200),
      pathTemplate: nonEmptyString.max(2000),
    }).strict(),
    z.object({
      key: nonEmptyString.max(100), kind: z.literal('card'), channelId: nonEmptyString.max(200),
      templateId: nonEmptyString.max(200),
    }).strict(),
  ])).max(20).superRefine((destinations, ctx) => {
    const keys = new Set<string>();
    destinations.forEach((destination, index) => {
      if (keys.has(destination.key)) ctx.addIssue({
        code: 'custom', path: [index, 'key'], message: `Duplicate destination key: ${destination.key}`,
      });
      keys.add(destination.key);
    });
  }).default([{ key: 'gateway_event', kind: 'gateway_event' }]),
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
  conversationMode: z.enum(['new_session', 'continuous']).default('new_session'),
  delivery: AutomationDeliveryPolicySchema.default({
    notificationPolicy: 'attention', destinations: [{ key: 'gateway_event', kind: 'gateway_event' }],
  }),
  reliability: AutomationReliabilitySchema.optional(),
  management: AutomationManagementSchema.optional(),
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
}).extend({
  conversationMode: z.enum(['new_session', 'continuous']),
  delivery: AutomationDeliveryPolicySchema.optional(),
  state: AutomationStateSchema,
}).partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided' },
);

export type CreateAutomationInput = z.infer<typeof CreateAutomationSchema>;
export type UpdateAutomationInput = z.infer<typeof UpdateAutomationSchema>;
