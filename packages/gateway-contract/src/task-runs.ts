import { z } from 'zod';

export const TaskExecutorKindSchema = z.enum(['agent', 'workflow', 'human', 'external']);
export const TaskRunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting',
  'verifying',
  'succeeded',
  'failed',
  'cancelled',
]);

const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

export const TaskRunSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  rootRunId: z.string(),
  parentRunId: z.string().optional(),
  attempt: z.number().int().positive(),
  status: TaskRunStatusSchema,
  executorKind: TaskExecutorKindSchema,
  executorRef: z.record(z.string(), z.unknown()),
  trigger: z.record(z.string(), z.unknown()),
  correlationId: z.string(),
  causationId: z.string().optional(),
  idempotencyKey: z.string(),
  contractVersion: z.number().int().positive(),
  contextSnapshotId: z.string().optional(),
  policySnapshot: z.record(z.string(), z.unknown()).optional(),
  sessionKey: z.string().optional(),
  queuedAt: z.number().int().nonnegative(),
  scheduledAt: z.number().int().nonnegative().optional(),
  startedAt: z.number().int().nonnegative().optional(),
  heartbeatAt: z.number().int().nonnegative().optional(),
  completedAt: z.number().int().nonnegative().optional(),
  timeoutAt: z.number().int().nonnegative().optional(),
  leaseOwner: z.string().optional(),
  leaseExpiresAt: z.number().int().nonnegative().optional(),
  retryPolicy: z.record(z.string(), z.unknown()),
  retryOfRunId: z.string().optional(),
  terminalCode: z.string().optional(),
  terminalMessage: z.string().optional(),
  version: z.number().int().positive(),
}).superRefine((run, context) => {
  if (!run.parentRunId && run.rootRunId !== run.id) {
    context.addIssue({
      code: 'custom',
      path: ['rootRunId'],
      message: 'A root run must reference itself',
    });
  }
  if (run.status !== 'queued' && (!run.contextSnapshotId || !run.policySnapshot)) {
    context.addIssue({
      code: 'custom',
      path: ['contextSnapshotId'],
      message: 'A dispatched run requires context and policy snapshots',
    });
  }
  if (TERMINAL_RUN_STATUSES.has(run.status) !== Boolean(run.completedAt)) {
    context.addIssue({
      code: 'custom',
      path: ['completedAt'],
      message: 'Only terminal runs have a completion timestamp',
    });
  }
});

export const TaskRunEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  sequence: z.number().int().positive(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  actor: z.record(z.string(), z.unknown()),
  occurredAt: z.number().int().nonnegative(),
});

export type TaskExecutorKind = z.infer<typeof TaskExecutorKindSchema>;
export type TaskRunStatus = z.infer<typeof TaskRunStatusSchema>;
export type TaskRun = z.infer<typeof TaskRunSchema>;
export type TaskRunEvent = z.infer<typeof TaskRunEventSchema>;
