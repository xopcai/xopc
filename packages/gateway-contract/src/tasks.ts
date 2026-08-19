import { z } from 'zod';

export const TaskStatusSchema = z.enum([
  'pending',
  'planning',
  'waiting_dependency',
  'running',
  'verifying',
  'needs_user',
  'blocked',
  'paused',
  'completed',
  'cancelled',
]);

export const TaskPrioritySchema = z.enum(['low', 'normal', 'high', 'critical']);

export const TaskContractSchema = z.object({
  taskId: z.string(),
  version: z.number().int().positive(),
  objective: z.string(),
  expectedOutputs: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  constraints: z.array(z.string()),
  approvalRequired: z.array(z.string()),
  assumptions: z.array(z.string()),
  risks: z.array(z.string()),
  contextSnapshotId: z.string().optional(),
  createdBy: z.enum(['user', 'system']),
  createdAt: z.number(),
});

export const TaskSchema = z.object({
  id: z.string(),
  objective: z.string(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  dueAt: z.number().optional(),
  latestContractVersion: z.number().int().positive(),
  latestReceiptRunId: z.string().optional(),
  contract: TaskContractSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const TaskListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(TaskSchema),
});

export const TaskCreateModeSchema = z.enum(['capture', 'start']);

export const TaskDependencySummarySchema = z.object({
  id: z.string(),
  objective: z.string(),
  status: TaskStatusSchema,
});

export const TaskCreateRequestSchema = z.object({
  requestId: z.string().uuid(),
  mode: TaskCreateModeSchema,
  objective: z.string().trim().min(1).max(12_000),
  projectId: z.string().trim().min(1).optional(),
  agentId: z.string().trim().min(1).optional(),
  locale: z.enum(['en', 'zh']).optional(),
  priority: TaskPrioritySchema.optional(),
  dueAt: z.number().int().nonnegative().optional(),
  dependsOnTaskIds: z.array(z.string().trim().min(1)).default([]),
}).strict();

export const TaskCreateResponseSchema = z.discriminatedUnion('mode', [
  z.object({
    ok: z.literal(true),
    mode: z.literal('capture'),
    task: TaskSchema,
  }),
  z.object({
    ok: z.literal(true),
    mode: z.literal('start'),
    task: TaskSchema,
    activation: z.discriminatedUnion('status', [
      z.object({ status: z.literal('queued'), queueId: z.string().min(1) }),
      z.object({ status: z.literal('already_started') }),
      z.object({
        status: z.literal('waiting_dependency'),
        dependencies: z.array(TaskDependencySummarySchema),
      }),
      z.object({
        status: z.literal('needs_approval'),
        requiredBoundaries: z.array(z.string().min(1)),
      }),
    ]),
  }),
]);

export const TaskActionSchema = z.enum(['run', 'pause', 'resume', 'verify', 'cancel']);
export const TaskActionRequestSchema = z.object({
  action: TaskActionSchema,
  expectedUpdatedAt: z.number().int().nonnegative(),
  approvedBoundaries: z.array(z.string().min(1)).optional(),
}).strict();

export const TaskDependencyUpdateRequestSchema = z.object({
  dependsOnTaskIds: z.array(z.string().trim().min(1)),
  expectedUpdatedAt: z.number().int().nonnegative(),
}).strict();

export const TaskReceiptStatusSchema = z.enum([
  'running',
  'completed',
  'partial',
  'needs_user',
  'failed',
  'cancelled',
]);

export const TaskEvidenceSchema = z.object({
  kind: z.enum(['artifact', 'test', 'state', 'source']),
  title: z.string(),
  summary: z.string(),
  uri: z.string().optional(),
  verifies: z.array(z.string()).optional(),
  provenance: z.enum(['tool', 'external', 'user', 'judge']),
  strength: z.enum(['observed', 'verified']),
  observedAt: z.number(),
});

export const TaskJudgmentSchema = z.object({
  recommendation: z.string(),
  reasons: z.array(z.string()),
  rejectedAlternatives: z.array(z.object({ option: z.string(), reason: z.string() })),
  uncertainty: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

export const TaskReceiptSchema = z.object({
  runId: z.string(),
  taskId: z.string().optional(),
  contractVersion: z.number().int().positive().optional(),
  sessionKey: z.string(),
  objective: z.string(),
  status: TaskReceiptStatusSchema,
  summary: z.string(),
  projectId: z.string().optional(),
  origin: z.string().optional(),
  triggerKind: z.string().optional(),
  attempt: z.number().int().positive(),
  strategy: z.string().optional(),
  changes: z.array(TaskEvidenceSchema),
  evidence: z.array(TaskEvidenceSchema),
  verification: z.object({
    status: z.enum(['passed', 'failed', 'unverified']),
    checks: z.array(z.object({
      criterion: z.string(),
      status: z.enum(['passed', 'failed', 'unverified']),
      evidenceTitles: z.array(z.string()),
    })),
  }),
  remainingWork: z.array(z.string()),
  nextAction: z.string().optional(),
  needsUser: z.boolean(),
  completionVerdict: z.enum(['achieved', 'partial', 'not_achieved']).optional(),
  correctionText: z.string().optional(),
  contextTraceId: z.string().optional(),
  failure: z.object({
    code: z.enum([
      'timeout',
      'approval_required',
      'verification_failed',
      'conflict',
      'tool_failed',
      'model_failed',
      'cancelled',
      'unknown',
    ]),
    phase: z.enum(['planning', 'approval', 'execution', 'verification', 'runtime']),
    recoveryAction: z.enum(['replan', 'retry_with_changed_strategy', 'request_user_input', 'none']),
  }).optional(),
  judgment: TaskJudgmentSchema.optional(),
  startedAt: z.number(),
  completedAt: z.number().optional(),
  feedback: z.object({
    rating: z.enum(['helpful', 'not_helpful']),
    reason: z.string().optional(),
    needsCorrection: z.boolean().optional(),
    supportFit: z.boolean().optional(),
  }).optional(),
});

export const TaskContextManifestSchema = z.object({
  taskId: z.string(),
  sources: z.array(z.object({
    kind: z.enum(['task_contract', 'execution_receipt', 'user_correction']),
    id: z.string(),
    description: z.string(),
  })),
  assumptions: z.array(z.string()),
  unresolvedCriteria: z.array(z.string()),
  allocation: z.enum(['deep', 'critical']),
});

export const TaskExecutionSummarySchema = z.object({
  sessionKey: z.string().optional(),
  nextAction: z.string().optional(),
  blockedReason: z.string().optional(),
  approvedBoundaries: z.array(z.string()),
  updatedAt: z.number(),
});

export const TaskProgressSchema = z.object({
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  currentStep: z.string().optional(),
  items: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
  })),
  updatedAt: z.number(),
});

export const TaskAttentionSchema = z.object({
  kind: z.enum(['input', 'approval', 'dependency']),
  summary: z.string(),
});

export const TaskDetailResponseSchema = z.object({
  ok: z.literal(true),
  task: TaskSchema,
  receipts: z.array(TaskReceiptSchema),
  execution: TaskExecutionSummarySchema.optional(),
  progress: TaskProgressSchema.optional(),
  attention: TaskAttentionSchema.optional(),
  nextCheckAt: z.number().int().nonnegative().optional(),
  dependencies: z.array(TaskDependencySummarySchema),
  dependents: z.array(TaskDependencySummarySchema),
  contextManifest: TaskContextManifestSchema.optional(),
});

export const TaskReceiptListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(TaskReceiptSchema),
});

export type TaskReceiptStatus = z.infer<typeof TaskReceiptStatusSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;
export type TaskContract = z.infer<typeof TaskContractSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;
export type TaskCreateMode = z.infer<typeof TaskCreateModeSchema>;
export type TaskCreateRequest = z.infer<typeof TaskCreateRequestSchema>;
export type TaskCreateResponse = z.infer<typeof TaskCreateResponseSchema>;
export type TaskAction = z.infer<typeof TaskActionSchema>;
export type TaskDependencyUpdateRequest = z.infer<typeof TaskDependencyUpdateRequestSchema>;
export type TaskDependencySummary = z.infer<typeof TaskDependencySummarySchema>;
export type TaskEvidence = z.infer<typeof TaskEvidenceSchema>;
export type TaskJudgment = z.infer<typeof TaskJudgmentSchema>;
export type TaskReceipt = z.infer<typeof TaskReceiptSchema>;
export type TaskContextManifest = z.infer<typeof TaskContextManifestSchema>;
export type TaskExecutionSummary = z.infer<typeof TaskExecutionSummarySchema>;
export type TaskProgress = z.infer<typeof TaskProgressSchema>;
export type TaskAttention = z.infer<typeof TaskAttentionSchema>;
export type TaskDetailResponse = z.infer<typeof TaskDetailResponseSchema>;
export type TaskReceiptListResponse = z.infer<typeof TaskReceiptListResponseSchema>;

export function parseTaskReceipt(value: unknown): TaskReceipt {
  return TaskReceiptSchema.parse(value);
}
