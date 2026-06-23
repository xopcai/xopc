import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);

const optionalTrimmedString = (max: number) =>
  z.preprocess((v) => {
    if (v === undefined) return undefined;
    if (v === null) return v;
    if (typeof v !== 'string') return v;
    const t = v.trim();
    return t.length === 0 ? undefined : t;
  }, z.string().min(1).max(max).optional());

export const CronScheduleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('at'),
    at: nonEmptyString,
  }).strict(),
  z.object({
    kind: z.literal('every'),
    everyMs: z.number().int().min(1),
    anchorMs: z.number().int().nonnegative().optional(),
  }).strict(),
  z.object({
    kind: z.literal('cron'),
    expr: nonEmptyString.superRefine((val, ctx) => {
      try {
        CronExpressionParser.parse(val);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid cron expression: ${val}`,
        });
      }
    }),
    tz: optionalTrimmedString(100),
    staggerMs: z.number().int().nonnegative().optional(),
  }).strict(),
]);

export const CronDeliverySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }).strict(),
  z.object({
    mode: z.literal('announce'),
    channel: optionalTrimmedString(32),
    to: optionalTrimmedString(200),
    accountId: optionalTrimmedString(100),
    threadId: z.union([z.string(), z.number()]).optional(),
    bestEffort: z.boolean().optional(),
    completionDestination: z.object({
      mode: z.literal('webhook'),
      to: nonEmptyString,
    }).strict().optional(),
    failureDestination: z.object({
      mode: z.enum(['announce', 'webhook']).optional(),
      channel: optionalTrimmedString(32),
      to: optionalTrimmedString(500),
      accountId: optionalTrimmedString(100),
    }).strict().optional(),
  }).strict(),
  z.object({
    mode: z.literal('webhook'),
    to: nonEmptyString,
    bestEffort: z.boolean().optional(),
  }).strict(),
]);

const CronSystemEventPayloadSchema = z.object({
  kind: z.literal('systemEvent'),
  text: z.string().min(1).max(50000),
}).strict();

const CronAgentTurnPayloadSchema = z.object({
  kind: z.literal('agentTurn'),
  message: z.string().min(1).max(50000),
  model: optionalTrimmedString(100),
  thinking: optionalTrimmedString(50),
  toolsAllow: z.array(z.string().trim().min(1)).optional(),
  timeoutSeconds: z.number().int().min(1).max(86400).optional(),
}).strict();

const CronGoalContinuePayloadSchema = z.object({
  kind: z.literal('goalContinue'),
  goalId: nonEmptyString.max(100),
  message: optionalTrimmedString(50000),
  maxRetries: z.number().int().min(0).max(10).optional(),
}).strict();

const WorkflowRunInputEnvelopeSchema = z.object({
  payload: z.unknown(),
  goal: optionalTrimmedString(5000),
  variables: z.record(z.string(), z.unknown()).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
}).strict();

const CronWorkflowRunPayloadSchema = z.object({
  kind: z.literal('workflowRun'),
  definitionId: nonEmptyString.max(200),
  input: z.unknown().optional(),
  inputEnvelope: WorkflowRunInputEnvelopeSchema.optional(),
  goal: optionalTrimmedString(5000),
  agentId: optionalTrimmedString(64),
  sessionKey: optionalTrimmedString(300),
  maxRetries: z.number().int().min(0).max(10).optional(),
  waitForCompletion: z.boolean().optional(),
  source: z.object({
    kind: z.literal('cron').optional(),
    scheduleId: optionalTrimmedString(200),
    fireId: optionalTrimmedString(200),
    scheduledAtMs: z.number().int().nonnegative().optional(),
  }).strict().optional(),
}).strict();

export const CronPayloadSchema = z.discriminatedUnion('kind', [
  CronSystemEventPayloadSchema,
  CronAgentTurnPayloadSchema,
  CronGoalContinuePayloadSchema,
  CronWorkflowRunPayloadSchema,
]);

export const CronFailureAlertSchema = z.object({
  after: z.number().int().min(1).optional(),
  cooldownMs: z.number().int().nonnegative().optional(),
  includeSkipped: z.boolean().optional(),
  mode: z.enum(['announce', 'webhook']).optional(),
  channel: optionalTrimmedString(32),
  to: optionalTrimmedString(500),
  accountId: optionalTrimmedString(100),
}).strict();

export const JobStateSchema = z.object({
  nextRunAtMs: z.number().int().nonnegative().optional(),
  runningAtMs: z.number().int().nonnegative().optional(),
  runningSessionKey: optionalTrimmedString(300),
  lastRunAtMs: z.number().int().nonnegative().optional(),
  lastRunStatus: z.enum(['ok', 'error', 'skipped']).optional(),
  lastError: z.string().optional(),
  lastDurationMs: z.number().int().nonnegative().optional(),
  consecutiveErrors: z.number().int().nonnegative().optional(),
  consecutiveSkipped: z.number().int().nonnegative().optional(),
  lastDeliveryStatus: z.enum(['delivered', 'not-delivered', 'unknown', 'not-requested']).optional(),
  lastDeliveryError: z.string().optional(),
  lastFailureAlertAtMs: z.number().int().nonnegative().optional(),
}).strict();

export const JobDataSchema = z.object({
  id: nonEmptyString.max(64),
  name: nonEmptyString.max(200),
  description: z.string().max(2000).optional(),
  enabled: z.boolean(),
  deleteAfterRun: z.boolean().optional(),
  createdAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(),
  schedule: CronScheduleSchema,
  sessionTarget: z.union([
    z.literal('main'),
    z.literal('isolated'),
    z.literal('current'),
    z.string().regex(/^session:.+$/),
  ]),
  wakeMode: z.enum(['now', 'next-heartbeat']),
  agentId: optionalTrimmedString(64),
  sessionKey: optionalTrimmedString(300),
  workingDirectory: optionalTrimmedString(4096),
  payload: CronPayloadSchema,
  delivery: CronDeliverySchema.optional(),
  failureAlert: z.union([z.literal(false), CronFailureAlertSchema]).optional(),
  state: JobStateSchema.default({}),
}).strict();

export const AddJobRequestSchema = JobDataSchema.omit({
  id: true,
  name: true,
  enabled: true,
  createdAtMs: true,
  updatedAtMs: true,
  sessionTarget: true,
  wakeMode: true,
  state: true,
}).extend({
  id: optionalTrimmedString(64),
  name: optionalTrimmedString(200),
  enabled: z.boolean().optional(),
  sessionTarget: JobDataSchema.shape.sessionTarget.optional(),
  wakeMode: JobDataSchema.shape.wakeMode.optional(),
  state: JobStateSchema.partial().optional(),
});

export const UpdateJobRequestSchema = JobDataSchema.omit({
  id: true,
  createdAtMs: true,
  updatedAtMs: true,
}).partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' },
);

export type ValidatedJobData = z.infer<typeof JobDataSchema>;
export type ValidatedAddJobRequest = z.infer<typeof AddJobRequestSchema>;
export type ValidatedUpdateJobRequest = z.infer<typeof UpdateJobRequestSchema>;
export type ValidatedCronPayload = z.infer<typeof CronPayloadSchema>;
export type ValidatedCronDelivery = z.infer<typeof CronDeliverySchema>;
