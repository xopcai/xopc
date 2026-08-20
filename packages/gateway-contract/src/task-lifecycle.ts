import { z } from 'zod';

export const TaskPhaseSchema = z.enum(['backlog', 'ready', 'active', 'review', 'closed']);
export const TaskResolutionSchema = z.enum(['done', 'cancelled', 'duplicate', 'wont_do']);
export const TaskOperationalStateSchema = z.enum([
  'idle',
  'queued',
  'running',
  'waiting',
  'verifying',
  'blocked',
]);

export const TaskWaitKindSchema = z.enum([
  'dependency',
  'user_input',
  'approval',
  'external_event',
  'scheduled_time',
  'retry_backoff',
  'paused',
]);
export const TaskWaitStatusSchema = z.enum(['active', 'resolved', 'cancelled']);

export const TaskWaitSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  taskRunId: z.string().optional(),
  kind: TaskWaitKindSchema,
  status: TaskWaitStatusSchema,
  reason: z.string(),
  condition: z.record(z.string(), z.unknown()),
  resumeAt: z.number().int().nonnegative().optional(),
  resolvedBy: z.record(z.string(), z.unknown()).optional(),
  resolution: z.unknown().optional(),
  createdAt: z.number().int().nonnegative(),
  resolvedAt: z.number().int().nonnegative().optional(),
});

export const TaskAttentionKindSchema = z.enum([
  'input_required',
  'approval_required',
  'dependency_blocked',
  'run_failed',
  'verification_failed',
  'overdue',
  'stale',
]);

export const TaskAttentionItemSchema = z.object({
  kind: TaskAttentionKindSchema,
  summary: z.string(),
  sourceId: z.string().optional(),
});

export type TaskPhase = z.infer<typeof TaskPhaseSchema>;
export type TaskResolution = z.infer<typeof TaskResolutionSchema>;
export type TaskOperationalState = z.infer<typeof TaskOperationalStateSchema>;
export type TaskWaitKind = z.infer<typeof TaskWaitKindSchema>;
export type TaskWaitStatus = z.infer<typeof TaskWaitStatusSchema>;
export type TaskWait = z.infer<typeof TaskWaitSchema>;
export type TaskAttentionKind = z.infer<typeof TaskAttentionKindSchema>;
export type TaskAttentionItem = z.infer<typeof TaskAttentionItemSchema>;
