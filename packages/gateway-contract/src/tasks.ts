import { z } from 'zod';

import {
  TaskAttentionItemSchema,
  TaskOperationalStateSchema,
  TaskPhaseSchema,
  TaskResolutionSchema,
  TaskWaitSchema,
} from './task-lifecycle.js';
import { TaskRunSchema } from './task-runs.js';

export {
  TaskAttentionItemSchema,
  TaskOperationalStateSchema,
  TaskPhaseSchema,
  TaskResolutionSchema,
  TaskWaitSchema,
} from './task-lifecycle.js';

export const TaskPrioritySchema = z.enum(['low', 'normal', 'high', 'critical']);
export const TaskChangedFieldSchema = z.enum([
  'title',
  'body',
  'phase',
  'resolution',
  'priority',
  'dueAt',
  'projectId',
  'milestoneId',
  'parentTaskId',
  'ownerId',
  'delegateAgentId',
  'boardRank',
  'contract',
  'dependencies',
  'context',
  'runs',
  'receipts',
  'attention',
  'conversation',
]);
export const TaskChangedEventSchema = z.object({
  taskId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  version: z.number().int().positive(),
  changedFields: z.array(TaskChangedFieldSchema).min(1),
  source: z.enum(['user', 'agent', 'runtime']),
  actorId: z.string().min(1).optional(),
  occurredAt: z.number().int().nonnegative(),
});
export const TaskAcceptancePolicySchema = z.enum([
  'verified_auto',
  'verified_then_review',
  'manual',
]);

export const ActorRefSchema = z.object({
  kind: z.enum(['user', 'agent', 'system', 'integration']),
  id: z.string().optional(),
});

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
  acceptancePolicy: TaskAcceptancePolicySchema,
  outputDestinations: z.array(z.record(z.string(), z.unknown())),
  createdBy: ActorRefSchema,
  createdAt: z.number().int().nonnegative(),
});

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().optional(),
  phase: TaskPhaseSchema,
  resolution: TaskResolutionSchema.optional(),
  priority: TaskPrioritySchema,
  dueAt: z.number().int().nonnegative().optional(),
  projectId: z.string().optional(),
  milestoneId: z.string().optional(),
  parentTaskId: z.string().optional(),
  ownerId: z.string().optional(),
  delegateAgentId: z.string().optional(),
  source: z.string(),
  locale: z.enum(['en', 'zh']).optional(),
  latestContractVersion: z.number().int().positive(),
  boardRank: z.number().finite().default(0),
  version: z.number().int().positive(),
  contract: TaskContractSchema.optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  closedAt: z.number().int().nonnegative().optional(),
}).superRefine((task, context) => {
  if ((task.phase === 'closed') !== Boolean(task.resolution)) {
    context.addIssue({
      code: 'custom',
      path: ['resolution'],
      message: 'Closed tasks require a resolution and open tasks cannot have one',
    });
  }
});

export const TaskContextRoleSchema = z.enum([
  'input',
  'reference',
  'constraint',
  'deliverable',
  'evidence',
]);

export const TaskContextEdgeSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  targetKind: z.enum([
    'document', 'file', 'url', 'session', 'memory', 'task', 'artifact', 'source',
  ]),
  targetId: z.string(),
  role: TaskContextRoleSchema,
  title: z.string().optional(),
  pinned: z.boolean(),
  retrievalPolicy: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()),
  createdBy: ActorRefSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const TaskAuthorityGrantSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  capability: z.string(),
  scope: z.record(z.string(), z.unknown()),
  grantedBy: ActorRefSchema,
  grantedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative().optional(),
  revokedAt: z.number().int().nonnegative().optional(),
});

export const TaskDependencySummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  phase: TaskPhaseSchema,
  resolution: TaskResolutionSchema.optional(),
  operationalState: TaskOperationalStateSchema,
});

export const TaskEvidenceSchema = z.object({
  kind: z.enum(['artifact', 'test', 'state', 'source']),
  title: z.string(),
  summary: z.string(),
  uri: z.string().optional(),
  verifies: z.array(z.string()).optional(),
  provenance: z.enum(['tool', 'external', 'user', 'judge']),
  strength: z.enum(['observed', 'verified']),
  observedAt: z.number().int().nonnegative(),
});

export const TaskJudgmentSchema = z.object({
  recommendation: z.string(),
  reasons: z.array(z.string()),
  rejectedAlternatives: z.array(z.object({ option: z.string(), reason: z.string() })),
  uncertainty: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

export const TaskRunReceiptSchema = z.object({
  runId: z.string(),
  status: z.enum(['succeeded', 'failed', 'cancelled']),
  summary: z.string(),
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
  failure: z.object({
    code: z.string(),
    phase: z.string(),
    recoveryAction: z.string(),
  }).optional(),
  judgment: TaskJudgmentSchema.optional(),
  contextTraceId: z.string().optional(),
  finalizedAt: z.number().int().nonnegative(),
});

export const TaskExecutorSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent'), agentId: z.string().min(1) }),
  z.object({
    kind: z.literal('workflow'),
    workflowId: z.string().min(1),
    workflowVersion: z.string().min(1).optional(),
    input: z.unknown().optional(),
  }),
  z.object({ kind: z.literal('human'), actorId: z.string().min(1) }),
  z.object({ kind: z.literal('external'), provider: z.string().min(1), config: z.unknown() }),
]);

export const TaskContractInputSchema = TaskContractSchema.omit({
  taskId: true,
  version: true,
  createdBy: true,
  createdAt: true,
});

export const TaskContextInputSchema = TaskContextEdgeSchema.omit({
  id: true,
  taskId: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

export const TaskCreateRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  body: z.string().trim().max(50_000).optional(),
  projectId: z.string().trim().min(1).optional(),
  milestoneId: z.string().trim().min(1).optional(),
  parentTaskId: z.string().trim().min(1).optional(),
  priority: TaskPrioritySchema.default('normal'),
  dueAt: z.number().int().nonnegative().optional(),
  ownerId: z.string().trim().min(1).optional(),
  delegateAgentId: z.string().trim().min(1).optional(),
  locale: z.enum(['en', 'zh']).optional(),
  contract: TaskContractInputSchema,
  dependencies: z.array(z.string().trim().min(1)).default([]),
  context: z.array(TaskContextInputSchema).default([]),
  authorityGrants: z.array(z.object({
    capability: z.string().min(1),
    scope: z.record(z.string(), z.unknown()).default({}),
    expiresAt: z.number().int().nonnegative().optional(),
  })).default([]),
  activation: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('capture'), phase: z.enum(['backlog', 'ready']).default('backlog') }),
    z.object({
      mode: z.literal('start'),
      executor: TaskExecutorSelectionSchema.optional(),
      scheduleAt: z.number().int().nonnegative().optional(),
    }),
  ]),
}).strict();

export const TaskPatchRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(500).optional(),
  body: z.string().trim().max(50_000).nullable().optional(),
  projectId: z.string().trim().min(1).nullable().optional(),
  milestoneId: z.string().trim().min(1).nullable().optional(),
  parentTaskId: z.string().trim().min(1).nullable().optional(),
  priority: TaskPrioritySchema.optional(),
  dueAt: z.number().int().nonnegative().nullable().optional(),
  ownerId: z.string().trim().min(1).nullable().optional(),
}).strict();

const TaskWaitInputSchema = z.object({
  kind: z.enum([
    'dependency', 'user_input', 'approval', 'external_event',
    'scheduled_time', 'retry_backoff', 'paused',
  ]),
  reason: z.string().min(1),
  condition: z.record(z.string(), z.unknown()).default({}),
  resumeAt: z.number().int().nonnegative().optional(),
});

export const TaskCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), phase: z.enum(['backlog', 'ready', 'active', 'review']) }),
  z.object({ type: z.literal('mark_ready') }),
  z.object({
    type: z.literal('start'),
    executor: TaskExecutorSelectionSchema,
    scheduleAt: z.number().int().nonnegative().optional(),
  }),
  z.object({ type: z.literal('request_review') }),
  z.object({ type: z.literal('close'), resolution: TaskResolutionSchema }),
  z.object({ type: z.literal('reopen'), phase: z.enum(['backlog', 'ready', 'active', 'review']) }),
  z.object({ type: z.literal('add_wait'), wait: TaskWaitInputSchema }),
  z.object({ type: z.literal('resolve_wait'), waitId: z.string(), resolution: z.unknown().optional() }),
  z.object({ type: z.literal('revise_contract'), contract: TaskContractInputSchema }),
]);

export const TaskCommandRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  expectedVersion: z.number().int().positive(),
  command: TaskCommandSchema,
}).strict();

export const TaskDependencyUpdateRequestSchema = z.object({
  dependsOnTaskIds: z.array(z.string().trim().min(1)),
  expectedVersion: z.number().int().positive(),
}).strict();

export const TaskBoardPositionRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  beforeTaskId: z.string().trim().min(1).nullable().optional(),
}).strict();

export const TaskListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(z.object({
    task: TaskSchema,
    operationalState: TaskOperationalStateSchema,
    attention: z.array(TaskAttentionItemSchema),
  })),
});

export const TaskCreateResponseSchema = z.object({
  ok: z.literal(true),
  task: TaskSchema,
  operationalState: TaskOperationalStateSchema,
  run: TaskRunSchema.optional(),
});

export const TaskConversationStateSchema = z.object({
  taskId: z.string(),
  activeSessionKey: z.string().optional(),
  currentExecutorAgentId: z.string().optional(),
  assignmentEpoch: z.number().int().nonnegative(),
  status: z.enum(['idle', 'active']),
  updatedAt: z.number().int().nonnegative(),
});

export const TaskSessionLinkSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  sessionKey: z.string(),
  role: z.enum(['primary', 'discussion', 'execution']),
  agentId: z.string().optional(),
  runId: z.string().optional(),
  assignmentEpoch: z.number().int().nonnegative(),
  status: z.enum(['active', 'completed', 'superseded', 'failed']),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),
  createdAt: z.number().int().nonnegative(),
});

export const TaskHandoffRequestSchema = z.object({
  toAgentId: z.string().trim().min(1),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();

export const TaskHandoffResponseSchema = z.object({
  ok: z.literal(true),
  task: TaskSchema,
  conversation: TaskConversationStateSchema,
  fromAgentId: z.string().optional(),
  toAgentId: z.string(),
  activeSessionKey: z.string(),
  assignmentEpoch: z.number().int().positive(),
});

export const TaskDetailResponseSchema = z.object({
  ok: z.literal(true),
  task: TaskSchema,
  operationalState: TaskOperationalStateSchema,
  attention: z.array(TaskAttentionItemSchema),
  waits: z.array(TaskWaitSchema),
  runs: z.array(TaskRunSchema),
  receipts: z.array(TaskRunReceiptSchema),
  context: z.array(TaskContextEdgeSchema),
  conversation: TaskConversationStateSchema,
  sessions: z.array(TaskSessionLinkSchema),
  authorityGrants: z.array(TaskAuthorityGrantSchema),
  dependencies: z.array(TaskDependencySummarySchema),
  dependents: z.array(TaskDependencySummarySchema),
  allowedCommands: z.array(z.string()),
});

export const TaskRunReceiptListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(TaskRunReceiptSchema),
});

export type TaskPriority = z.infer<typeof TaskPrioritySchema>;
export type TaskAcceptancePolicy = z.infer<typeof TaskAcceptancePolicySchema>;
export type ActorRef = z.infer<typeof ActorRefSchema>;
export type TaskContract = z.infer<typeof TaskContractSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type TaskContextRole = z.infer<typeof TaskContextRoleSchema>;
export type TaskContextEdge = z.infer<typeof TaskContextEdgeSchema>;
export type TaskAuthorityGrant = z.infer<typeof TaskAuthorityGrantSchema>;
export type TaskDependencySummary = z.infer<typeof TaskDependencySummarySchema>;
export type TaskEvidence = z.infer<typeof TaskEvidenceSchema>;
export type TaskJudgment = z.infer<typeof TaskJudgmentSchema>;
export type TaskRunReceipt = z.infer<typeof TaskRunReceiptSchema>;
export type TaskExecutorSelection = z.infer<typeof TaskExecutorSelectionSchema>;
export type TaskContractInput = z.infer<typeof TaskContractInputSchema>;
export type TaskContextInput = z.infer<typeof TaskContextInputSchema>;
export type TaskCreateRequest = z.infer<typeof TaskCreateRequestSchema>;
export type TaskPatchRequest = z.infer<typeof TaskPatchRequestSchema>;
export type TaskChangedField = z.infer<typeof TaskChangedFieldSchema>;
export type TaskChangedEvent = z.infer<typeof TaskChangedEventSchema>;
export type TaskCommand = z.infer<typeof TaskCommandSchema>;
export type TaskCommandRequest = z.infer<typeof TaskCommandRequestSchema>;
export type TaskDependencyUpdateRequest = z.infer<typeof TaskDependencyUpdateRequestSchema>;
export type TaskBoardPositionRequest = z.infer<typeof TaskBoardPositionRequestSchema>;
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;
export type TaskCreateResponse = z.infer<typeof TaskCreateResponseSchema>;
export type TaskConversationState = z.infer<typeof TaskConversationStateSchema>;
export type TaskSessionLink = z.infer<typeof TaskSessionLinkSchema>;
export type TaskHandoffRequest = z.infer<typeof TaskHandoffRequestSchema>;
export type TaskHandoffResponse = z.infer<typeof TaskHandoffResponseSchema>;
export type TaskDetailResponse = z.infer<typeof TaskDetailResponseSchema>;
export type TaskRunReceiptListResponse = z.infer<typeof TaskRunReceiptListResponseSchema>;

export function parseTaskRunReceipt(value: unknown): TaskRunReceipt {
  return TaskRunReceiptSchema.parse(value);
}
