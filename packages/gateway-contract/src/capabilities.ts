import { z } from 'zod';
import { AppContextEnvelopeSchema, ResolvedAppContextSchema } from './app-context.js';
import { TaskPhaseSchema, TaskWaitSchema } from './task-lifecycle.js';
import { TaskDetailResponseSchema, TaskListResponseSchema, TaskPrioritySchema, TaskRunReceiptSchema } from './tasks.js';
import { TaskRunSchema, TaskRunEventSchema } from './task-runs.js';
import { AutomationSchema, AutomationRunSchema, AutomationRunEventSchema, AutomationMetricsSchema } from './automations.js';
import { TaskValueMetricsSchema } from './home.js';
import { sceneTemplateSchema, SceneActivationSchema, scenePreferencesSchema, activationInputSchema, SceneConfigureSchema,
  SceneWorkItemCreateSchema, SceneWorkItemUpdateSchema, SceneWorkItemSchema, sceneNotesSchema,
  ScenePreferencePatchSchema, SceneFeedbackSchema, SceneTransitionSchema, sceneScheduleSchema } from './scenes.js';

export const CapabilitySurfaceSchema = z.enum(['http', 'agent', 'cli', 'automation', 'mcp', 'extension']);
export type CapabilitySurface = z.infer<typeof CapabilitySurfaceSchema>;
export const CapabilityErrorCodeSchema = z.enum([
  'INVALID_INPUT', 'FORBIDDEN', 'NOT_FOUND', 'REVISION_CONFLICT', 'CONTRACT_CHANGED',
  'APPROVAL_REQUIRED', 'IN_PROGRESS', 'UNAVAILABLE', 'OUTCOME_UNKNOWN', 'CANCELLED', 'INTERNAL',
]);
export type CapabilityErrorCode = z.infer<typeof CapabilityErrorCodeSchema>;

export const CapabilityCallSchema = z.strictObject({
  majorVersion: z.number().int().positive(),
  descriptorDigest: z.string().regex(/^[a-f0-9]{64}$/),
  input: z.json(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});
export type CapabilityCall = z.infer<typeof CapabilityCallSchema>;

export const AutomationSimulationSchema = z.object({ triggerSummary: z.string(), actionSummary: z.string(), safetyNotes: z.array(z.string()),
  requiredConfirmations: z.array(z.string()), canRunNow: z.boolean(), runNowBlockedReason: z.string().optional() });
export const AutomationDraftRequestSchema = z.strictObject({ agentId: z.string().trim().min(1).max(64).optional(), language: z.enum(['en', 'zh']).default('en') });
export const AutomationDraftOutputSchema = z.object({ draftId: z.string(), explanation: z.string(), assumptions: z.array(z.string()), risks: z.array(z.string()),
  automation: z.looseObject({ name: z.string(), trigger: z.json(), action: z.json() }), simulation: AutomationSimulationSchema,
  repairAttempts: z.number().int().nonnegative() });
export const AutomationRepairDraftOutputSchema = z.object({ draftId: z.string(), patch: z.record(z.string(), z.json()), explanation: z.string(), expectedEffect: z.string(),
  risks: z.array(z.string()), requiresApproval: z.boolean(), repairAttempts: z.number().int().nonnegative() });

export const ResourceChangedSchema = z.strictObject({
  eventId: z.string().min(1), kind: z.enum(['note', 'task', 'project', 'automation', 'scene', 'local_app']),
  id: z.string().min(1), revision: z.number().int().nonnegative(),
  operation: z.enum(['created', 'updated', 'deleted']), operationId: z.string().optional(),
});
export type ResourceChanged = z.infer<typeof ResourceChangedSchema>;

export interface CapabilityDescriptor {
  id: string;
  majorVersion: number;
  descriptorDigest: string;
  description: string;
  effect: 'read' | 'local-write' | 'external-write' | 'destructive';
  surfaces: CapabilitySurface[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export const CapabilityResourceInputSchema = z.strictObject({ id: z.string().trim().min(1).max(512) });
export const LocalAppAcceptanceInputSchema = z.strictObject({
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(['passed', 'failed']),
  interactiveCount: z.number().int().min(0).max(10000),
  checks: z.array(z.strictObject({ id: z.enum(['document', 'content', 'interaction', 'criteria']),
    status: z.enum(['passed', 'failed', 'skipped']), message: z.string().trim().min(1).max(500) })).min(3).max(4),
});
export const LocalAppAcceptanceOutputSchema = LocalAppAcceptanceInputSchema.extend({
  id: z.string(), appId: z.string(), createdAt: z.number().int().nonnegative(),
});
export const ScenePageInputSchema = z.strictObject({ limit: z.number().int().min(1).max(100).default(50), afterId: z.string().max(200).default('') });
export const SceneWriteContracts = {
  'xopc.scenes.start': { input: activationInputSchema, output: z.object({ activation: SceneActivationSchema }) },
  'xopc.scenes.transition': { input: SceneTransitionSchema.extend({ id: z.string().min(1).max(512) }), output: z.object({ activation: SceneActivationSchema }) },
  'xopc.scenes.set_preferences': { input: ScenePreferencePatchSchema, output: scenePreferencesSchema.extend({ revision: z.number().int().positive() }) },
  'xopc.scenes.feedback': { input: SceneFeedbackSchema.extend({ id: z.string().min(1).max(512) }), output: z.object({ revision: z.number().int().positive() }) },
  'xopc.scenes.mark_read': { input: CapabilityResourceInputSchema.extend({ read: z.boolean() }), output: z.object({ ok: z.literal(true), presentationId: z.string(), read: z.boolean() }) },
  'xopc.scenes.schedule': { input: CapabilityResourceInputSchema.extend({ triggerKey: z.string().min(1).max(200), expectedRevision: z.number().int().nonnegative(), schedule: sceneScheduleSchema }), output: z.object({ revision: z.number().int().positive() }) },
  'xopc.scenes.configure': { input: SceneConfigureSchema.extend({ id: z.string().min(1).max(512) }), output: z.object({ activation: SceneActivationSchema }) },
  'xopc.scenes.check': { input: CapabilityResourceInputSchema, output: z.object({ intentId: z.string() }) },
  'xopc.scenes.notes': { input: sceneNotesSchema.extend({ id: z.string().min(1).max(512) }), output: z.object({ revision: z.number().int().positive() }) },
  'xopc.scenes.work_item': { input: SceneWorkItemCreateSchema.extend({ id: z.string().min(1).max(512) }), output: z.object({ workItem: SceneWorkItemSchema }) },
  'xopc.scenes.update_work_item': { input: SceneWorkItemUpdateSchema.safeExtend({ id: z.string().min(1).max(512) }), output: z.object({ workItem: SceneWorkItemSchema }) },
} as const;
const SceneOutcomeReadSchema = z.looseObject({ id: z.string(), activationId: z.string(), outcomeId: z.string(), status: z.string(),
  content: z.json(), readOnly: z.boolean(), createdAt: z.number(),
  sources: z.array(z.object({ kind: z.string(), title: z.string(), sender: z.string(), href: z.string() })),
  sourceHealth: z.record(z.string(), z.json()).nullable(),
});
export const TaskRunCancelInputSchema = CapabilityResourceInputSchema.extend({
  expectedVersion: z.number().int().positive(), reason: z.string().trim().min(1).max(4096).default('TaskRun cancelled'),
});
export const TaskRunFeedbackInputSchema = CapabilityResourceInputSchema.extend({
  rating: z.enum(['helpful', 'not_helpful']), reason: z.string().trim().max(4096).optional(),
});
export const TaskRunFeedbackOutputSchema = z.object({ ok: z.literal(true), feedback: z.object({
  id: z.string(), runId: z.string(), rating: z.enum(['helpful', 'not_helpful']), reason: z.string().optional(), createdAt: z.number(),
}) });
export const TaskRunCancelOutputSchema = z.object({
  ok: z.literal(true), run: TaskRunSchema, receipt: TaskRunReceiptSchema,
  model: TaskDetailResponseSchema.pick({ task: true, operationalState: true, attention: true, allowedCommands: true }),
  executionStopConfirmed: z.literal(false),
});
export const AutomationSetEnabledInputSchema = CapabilityResourceInputSchema.extend({
  enabled: z.boolean(), expectedRevision: z.number().int().nonnegative(),
});
export const AutomationMutationOutputSchema = z.object({ ok: z.literal(true), automation: AutomationSchema.loose() });
export const AutomationRunMutationOutputSchema = AutomationMutationOutputSchema.extend({ run: AutomationRunSchema.loose() });
export const AutomationCancelOutputSchema = z.object({ ok: z.literal(true), cancelled: z.boolean(), confirmed: z.boolean() });
export const AutomationReadOutputSchema = z.object({ ok: z.literal(true), marked: z.literal(true) });
export const AutomationReadAllInputSchema = z.strictObject({ projectId: z.string().trim().min(1).max(512).optional() });
export const AutomationReadAllOutputSchema = z.object({ ok: z.literal(true), count: z.number().int().nonnegative() });
export const AutomationDeleteInputSchema = CapabilityResourceInputSchema.extend({
  expectedRevision: z.number().int().nonnegative().nullable(),
});
export const AutomationDeleteOutputSchema = z.object({
  ok: z.literal(true), removed: z.boolean(), automation: AutomationSchema.loose().optional(), cancelRunId: z.string().optional(),
});
export const NoteListInputSchema = z.strictObject({
  status: z.enum(['inbox', 'processed', 'archived', 'trashed']).optional(),
  kind: z.enum(['thought', 'todo', 'voice', 'media', 'bookmark', 'mixed', 'task']).optional(),
  tag: z.string().max(512).optional(),
  projectId: z.string().min(1).max(512).optional(),
  unassigned: z.boolean().optional(),
  agentEdited: z.boolean().optional(),
  search: z.string().max(4096).optional(),
  pinned: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  sortBy: z.enum(['createdAt', 'updatedAt', 'lastOpenedAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

// Extra domain metadata is preserved; the capability validates its stable result fields.
export const NoteRecordSchema = z.looseObject({
  id: z.string().min(1),
  markdown: z.string(),
  kind: z.enum(['thought', 'todo', 'voice', 'media', 'bookmark', 'mixed', 'task']),
  status: z.enum(['inbox', 'processed', 'archived', 'trashed']),
  createdAt: z.number(),
  updatedAt: z.number(),
  title: z.string().optional(),
  localVersion: z.number().optional(),
});
export const NoteGetOutputSchema = z.object({ note: NoteRecordSchema });
export const NoteDeleteInputSchema = CapabilityResourceInputSchema.extend({ expectedRevision: z.number().int().positive(), revokeShares: z.boolean().default(true) });
export const NoteDeleteOutputSchema = z.object({ deleted: z.literal(true), revokedShares: z.number().int().nonnegative() });
export const NoteCreateInputSchema = z.strictObject({
  title: z.string().max(1000).optional(), markdown: z.string().max(2_000_000).default(''),
  kind: NoteRecordSchema.shape.kind.optional(), tags: z.array(z.string().max(512)).max(100).optional(),
  capturedVia: z.strictObject({ channel: z.enum(['app', 'web', 'electron', 'tui', 'telegram', 'wechat', 'feishu']),
    platform: z.enum(['ios', 'android', 'harmonyos']).optional() }).default({ channel: 'web' }),
  pinned: z.boolean().default(false), projectId: z.string().min(1).optional(),
});
export const NoteUpdateInputSchema = z.strictObject({
  id: z.string().min(1), expectedRevision: z.number().int().positive(),
  trigger: z.enum(['edit', 'ai_edit', 'sync', 'restore']).optional(),
  patch: z.strictObject({
    title: z.string().max(1000).optional(), markdown: z.string().max(2_000_000).optional(),
    tags: z.array(z.string().max(512)).max(100).optional(), pinned: z.boolean().optional(),
    kind: NoteRecordSchema.shape.kind.optional(), status: NoteRecordSchema.shape.status.optional(),
    localVersion: z.number().int().positive().optional(),
    ai: z.record(z.string(), z.json()).optional(), aiDeep: z.looseObject({ processedAt: z.number() }).optional(),
  }),
});
export const NoteCaptureInputSchema = z.strictObject({
  text: z.string().trim().min(1).max(2_000_000), capturedVia: NoteCreateInputSchema.shape.capturedVia,
});
export const NoteAppendInputSchema = z.strictObject({
  id: z.string().min(1), expectedRevision: z.number().int().positive().optional(),
  content: z.string().trim().min(1).max(2_000_000), heading: z.string().trim().min(1).max(1000).default('AI 讨论沉淀'),
});
export const NoteRestoreInputSchema = z.strictObject({
  id: z.string().min(1), timestamp: z.number().int().positive(), expectedRevision: z.number().int().positive(),
});
export const NoteListOutputSchema = z.looseObject({
  items: z.array(z.looseObject({ id: z.string().min(1) })),
  total: z.number().int().nonnegative(),
});

export const TaskListInputSchema = z.strictObject({
  phase: TaskPhaseSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  projectId: z.string().min(1).max(512).optional(),
  search: z.string().max(4096).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().nonnegative().default(0),
});

/** Single source for server definitions and typed clients. */
export const ProjectRecordSchema = z.looseObject({
  id: z.string().min(1), name: z.string(), slug: z.string(),
  status: z.enum(['planned', 'active', 'paused', 'completed', 'cancelled', 'archived']),
  executionMode: z.enum(['local_checkout', 'managed_worktree']),
  successCriteria: z.array(z.string()), scope: z.record(z.string(), z.unknown()), nonGoals: z.array(z.string()),
  health: z.enum(['unknown', 'on_track', 'at_risk', 'off_track']), version: z.number().int().positive(),
  createdAt: z.number(), updatedAt: z.number(), workspaceRoot: z.string().optional(), defaultAgentId: z.string().optional(),
});
export const ProjectSetPinnedInputSchema = z.strictObject({
  id: z.string().trim().min(1), expectedVersion: z.number().int().positive(), pinned: z.boolean(),
});
export const ProjectMutationOutputSchema = z.object({ ok: z.literal(true), project: ProjectRecordSchema });
export const ProjectResolveWorkspaceInputSchema = z.strictObject({
  workspacePath: z.string().trim().min(1).max(4096),
  agentId: z.string().trim().min(1).max(512).optional(),
  defaultAgentId: z.string().trim().max(512).optional(),
  projectKind: z.enum(['auto', 'coding', 'general', 'unknown']).optional(),
  autoCreate: z.boolean().default(false),
  conversationId: z.uuid().optional(),
});
export const ProjectResolveWorkspaceOutputSchema = z.object({
  ok: z.literal(true), project: ProjectRecordSchema.nullable(),
  reason: z.enum(['exact', 'contained', 'auto_created']).optional(), created: z.boolean().optional(),
});
export const ProjectDeleteInputSchema = ProjectSetPinnedInputSchema.omit({ pinned: true });
export const ProjectDeleteOutputSchema = z.object({ ok: z.literal(true), deleted: z.literal(true), executionStopConfirmed: z.literal(false) });
const ProjectFields = {
  name: z.string().trim().min(1).max(1000).optional(), description: z.string().max(20000).optional(),
  defaultAgentId: z.string().trim().max(512).optional(), workspaceRoot: z.string().trim().min(1).max(4096).optional(),
  createWorkspaceRoot: z.boolean().optional(), executionMode: ProjectRecordSchema.shape.executionMode.optional(),
  brief: z.string().max(20000).optional(), instructions: z.string().max(100000).optional(),
  outcome: z.string().max(20000).optional(), successCriteria: z.array(z.string().max(4096)).max(100).optional(),
  scope: z.record(z.string(), z.json()).optional(), nonGoals: z.array(z.string().max(4096)).max(100).optional(),
  health: ProjectRecordSchema.shape.health.optional(), ownerId: z.string().max(512).optional(),
  targetAt: z.number().finite().optional(),
};
export const ProjectCreateInputSchema = z.strictObject({ ...ProjectFields,
  projectKind: z.enum(['auto', 'coding', 'general', 'unknown']).optional(), autoUnderstand: z.boolean().default(false),
}).refine(input => Boolean(input.name || input.workspaceRoot), 'name or workspaceRoot is required');
export const ProjectEditInputSchema = z.strictObject({
  id: z.string().trim().min(1), expectedVersion: z.number().int().positive(),
  patch: z.strictObject({ ...ProjectFields, status: ProjectRecordSchema.shape.status.optional(),
    description: ProjectFields.description.unwrap().nullable().optional(),
    defaultAgentId: ProjectFields.defaultAgentId.unwrap().nullable().optional(),
    workspaceRoot: z.string().trim().max(4096).nullable().optional(),
    brief: ProjectFields.brief.unwrap().nullable().optional(), instructions: ProjectFields.instructions.unwrap().nullable().optional(),
    outcome: ProjectFields.outcome.unwrap().nullable().optional(), ownerId: ProjectFields.ownerId.unwrap().nullable().optional(),
    targetAt: ProjectFields.targetAt.unwrap().nullable().optional(),
  }).refine(input => Object.values(input).some(value => value !== undefined), 'Empty project patch'),
});
export const ProjectListInputSchema = z.strictObject({
  status: ProjectRecordSchema.shape.status.optional(), search: z.string().max(4096).optional(),
  sortBy: z.enum(['updatedAt', 'createdAt', 'name']).optional(), sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().min(1).max(500).default(50), offset: z.number().int().nonnegative().default(0),
});
export const LocalAppRecordSchema = z.looseObject({
  id: z.string(), extensionId: z.string(), projectId: z.string(), name: z.string(), idea: z.string(),
  status: z.enum(['preview_ready', 'installed', 'degraded']), workspaceRoot: z.string(),
  draftVersion: z.number().int(), installationState: z.enum(['not_installed', 'installed']), enabled: z.boolean(),
  createdAt: z.number(), updatedAt: z.number(),
});
export const LocalAppDetailSchema = LocalAppRecordSchema.extend({
  previewUrl: z.string(), permissions: z.array(z.string()),
  releases: z.array(z.looseObject({ id: z.string(), appId: z.string(), version: z.number().int(), sourceHash: z.string(),
    healthStatus: z.enum(['healthy', 'failed']), createdAt: z.number(), isActive: z.boolean() })),
  acceptanceRuns: z.array(z.looseObject({ id: z.string(), appId: z.string(), sourceHash: z.string(),
    status: z.enum(['passed', 'failed']), createdAt: z.number(), interactiveCount: z.number().int().nonnegative(),
    checks: z.array(z.object({ id: z.enum(['document', 'content', 'interaction', 'criteria']), status: z.enum(['passed', 'failed', 'skipped']), message: z.string() })),
  })),
});
export const ProjectMilestoneSchema = z.looseObject({ id: z.string(), projectId: z.string(), title: z.string(),
  status: z.enum(['planned', 'active', 'completed', 'cancelled']), sortOrder: z.number(), createdAt: z.number(), updatedAt: z.number() });
export const LocalAppValidationSchema = z.object({
  status: z.enum(['healthy', 'failed']), checkedAt: z.number(), sourceHash: z.string().optional(), hasDraftChanges: z.boolean(),
  changedFiles: z.array(z.object({ path: z.string(), status: z.enum(['added', 'modified', 'deleted']) })), changedFileCount: z.number().int().nonnegative(),
  permissions: z.array(z.string()), permissionDelta: z.object({ added: z.array(z.string()), removed: z.array(z.string()) }),
  acceptanceScenarioCount: z.number().int().nonnegative(), acceptanceScenarios: z.array(z.object({ id: z.string(), name: z.string(), stepCount: z.number().int().nonnegative() })),
  issues: z.array(z.object({ code: z.string(), severity: z.enum(['error', 'warning']), message: z.string() })),
});
export const ProjectUpdateSchema = z.looseObject({ id: z.string(), projectId: z.string(), summary: z.string(),
  health: ProjectRecordSchema.shape.health, createdAt: z.number() });
const MilestoneFields = {
  title: z.string().trim().min(1).max(1000), description: z.string().max(20000).optional(),
  status: ProjectMilestoneSchema.shape.status.optional(), targetAt: z.number().int().nonnegative().optional(),
  sortOrder: z.number().int().optional(),
};
export const ProjectMilestoneCreateInputSchema = z.strictObject({ projectId: z.string().trim().min(1), ...MilestoneFields });
export const ProjectMilestoneUpdateInputSchema = z.strictObject({
  projectId: z.string().trim().min(1), id: z.string().trim().min(1), expectedRevision: z.number().int().nonnegative(),
  patch: z.strictObject({ ...MilestoneFields, description: z.string().max(20000).nullable().optional(), targetAt: z.number().int().nonnegative().nullable().optional() })
    .partial().refine(value => Object.values(value).some(item => item !== undefined), 'Empty milestone patch'),
});
export const ProjectMilestoneDeleteInputSchema = ProjectMilestoneUpdateInputSchema.omit({ patch: true });
export const ProjectMilestoneOutputSchema = z.object({ ok: z.literal(true), milestone: ProjectMilestoneSchema, project: ProjectRecordSchema });
export const ProjectMilestoneDeleteOutputSchema = z.object({ ok: z.literal(true), deleted: z.literal(true) });
export const ProjectUpdateCreateInputSchema = z.strictObject({
  projectId: z.string().trim().min(1), expectedVersion: z.number().int().positive(),
  health: ProjectRecordSchema.shape.health, summary: z.string().trim().min(1).max(20000),
  progress: z.array(z.string().max(10000)).max(100).default([]),
  risks: z.array(z.string().max(10000)).max(100).default([]), nextSteps: z.array(z.string().max(10000)).max(100).default([]),
});
export const ProjectUpdateOutputSchema = z.object({ ok: z.literal(true), update: ProjectUpdateSchema, project: ProjectRecordSchema });

export const ProductReadContracts = {
  'xopc.context.resolve': { input: AppContextEnvelopeSchema, output: ResolvedAppContextSchema },
  'xopc.notes.preview_edit': {
    input: CapabilityResourceInputSchema.extend({ instruction: z.string().trim().min(1).max(16000), markdown: z.string().max(2_000_000).optional() }),
    output: z.object({ message: z.string(), patch: z.object({ id: z.string(), summary: z.string(),
      operations: z.array(z.object({ type: z.literal('replaceRange'), from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), markdown: z.string() })),
    }) }),
  },
  'xopc.automations.get_run': { input: CapabilityResourceInputSchema,
    output: z.object({ ok: z.literal(true), run: AutomationRunSchema.loose() }) },
  'xopc.automations.run_events': { input: CapabilityResourceInputSchema,
    output: z.object({ ok: z.literal(true), events: z.array(AutomationRunEventSchema.loose()) }) },
  'xopc.automations.metrics': { input: z.strictObject({}),
    output: z.object({ ok: z.literal(true), metrics: AutomationMetricsSchema }) },
  'xopc.automations.product_events': { input: z.strictObject({
    eventType: z.string().trim().min(1).max(512), source: z.string().trim().min(1).max(512).optional(),
    payloadKey: z.string().trim().min(1).max(512).optional(), payloadValue: z.string().max(4096).optional(),
    limit: z.number().int().min(1).max(100).default(10),
  }).refine(input => (input.payloadKey === undefined) === (input.payloadValue === undefined),
    'payloadKey and payloadValue must be supplied together'),
  output: z.object({ ok: z.literal(true), items: z.array(z.object({ run: AutomationRunSchema.loose(), triggerEvent: AutomationRunEventSchema.loose() })) }) },
  'xopc.automations.list': { input: z.strictObject({ projectId: z.string().trim().min(1).optional() }),
    output: z.object({ ok: z.literal(true), items: z.array(AutomationSchema.loose()), projectId: z.string().optional() }) },
  'xopc.automations.get': { input: CapabilityResourceInputSchema,
    output: z.object({ ok: z.literal(true), automation: AutomationSchema.loose() }) },
  'xopc.automations.history': { input: z.strictObject({ automationId: z.string().trim().min(1).optional(),
    projectId: z.string().trim().min(1).optional(), limit: z.number().int().min(1).max(200).default(50) }),
    output: z.object({ ok: z.literal(true), items: z.array(AutomationRunSchema.loose()), projectId: z.string().optional() }) },
  'xopc.scenes.templates': { input: z.strictObject({}), output: z.object({ templates: z.array(sceneTemplateSchema) }) },
  'xopc.scenes.mail_accounts': { input: z.strictObject({}), output: z.object({ accounts: z.array(z.object({ id: z.string(), label: z.string() })) }) },
  'xopc.scenes.mail_sources': { input: ScenePageInputSchema, output: z.object({ sources: z.array(z.object({ id: z.string(), accountId: z.string(), subject: z.string(), sender: z.string() })), nextCursor: z.string().nullable() }) },
  'xopc.scenes.results': { input: ScenePageInputSchema.extend({ activationId: z.string().min(1).max(200).optional() }), output: z.object({ outcomes: z.array(SceneOutcomeReadSchema), nextCursor: z.string().nullable() }) },
  'xopc.scenes.get_presentation': { input: CapabilityResourceInputSchema, output: z.object({ outcome: SceneOutcomeReadSchema }) },
  'xopc.scenes.get_feedback': { input: CapabilityResourceInputSchema, output: z.object({ feedback: z.object({ rating: z.enum(['useful', 'not_useful']), note: z.string(), revision: z.number().int().nonnegative() }).nullable() }) },
  'xopc.scenes.digest_results': { input: ScenePageInputSchema.extend({ id: z.string().min(1).max(512) }), output: z.object({ outcomes: z.array(SceneOutcomeReadSchema), nextCursor: z.string().nullable() }) },
  'xopc.scenes.metrics': { input: z.strictObject({ days: z.number().int().min(1).max(90).default(7) }), output: z.object({
    window: z.object({ since: z.number(), until: z.number(), days: z.number().int() }),
    ratedOutcomes: z.number().int().nonnegative(), usefulOutcomes: z.number().int().nonnegative(), unhelpfulOutcomes: z.number().int().nonnegative(),
    scenesWithUsefulOutcomes: z.number().int().nonnegative(), checks: z.number().int().nonnegative(), failedChecks: z.number().int().nonnegative(), skippedChecks: z.number().int().nonnegative(),
  }) },
  'xopc.scenes.diagnostics': { input: z.strictObject({}), output: z.object({ checksPaused: z.boolean(), currentModel: z.string().nullable(),
    pendingChecks: z.number().int().nonnegative(), oldestDueWaitMs: z.number().nonnegative(),
    lastSevenDays: z.object({ modelCalls: z.number().int().nonnegative(), connectorReads: z.number().int().nonnegative(), tokens: z.number().nonnegative(), estimatedCost: z.number().nonnegative() }),
    notifications: z.array(z.object({ status: z.string(), count: z.number().int().nonnegative() })), activations: z.array(z.record(z.string(), z.json())),
  }) },
  'xopc.scenes.get_preferences': { input: z.strictObject({}), output: scenePreferencesSchema.extend({ revision: z.number().int().nonnegative() }) },
  'xopc.scenes.preflight': { input: activationInputSchema, output: z.object({ ready: z.boolean(), missing: z.array(z.string()) }) },
  'xopc.scenes.get_template': { input: z.strictObject({ key: z.string().min(1).max(200), version: z.string().min(1).max(200) }), output: z.object({ template: sceneTemplateSchema }) },
  'xopc.scenes.list': { input: ScenePageInputSchema, output: z.object({ activations: z.array(SceneActivationSchema), nextCursor: z.string().nullable() }) },
  'xopc.scenes.get': { input: CapabilityResourceInputSchema, output: z.object({ activation: SceneActivationSchema,
    runs: z.array(z.looseObject({ id: z.string(), status: z.string(), attempt: z.number().int(), reason: z.string().nullable(), createdAt: z.number() })),
    schedules: z.array(z.looseObject({ triggerKey: z.string(), revision: z.number().int(), nextDueAt: z.number(), schedule: z.json() })),
  }) },
  'xopc.scenes.read_notes': { input: CapabilityResourceInputSchema, output: z.object({ notes: z.object({ content: z.string(), revision: z.number().int().nonnegative(), validUntil: z.number().nullable() }) }) },
  'xopc.scenes.list_runs': { input: ScenePageInputSchema.extend({ id: z.string().min(1).max(512) }), output: z.object({
    runs: z.array(z.looseObject({ id: z.string(), activationId: z.string(), status: z.string(), attempt: z.number().int(), reason: z.string().nullable(), createdAt: z.number() })), nextCursor: z.string().nullable(),
  }) },
  'xopc.scenes.list_schedules': { input: CapabilityResourceInputSchema, output: z.object({
    schedules: z.array(z.looseObject({ triggerKey: z.string(), revision: z.number().int(), nextDueAt: z.number(), schedule: z.json() })),
  }) },
  'xopc.scenes.list_work_items': { input: ScenePageInputSchema.extend({ id: z.string().min(1).max(512) }), output: z.object({
    workItems: z.array(z.looseObject({ id: z.string(), subjectId: z.string(), accountId: z.string(), dueAt: z.number(), status: z.string(), revision: z.number().int(), lastCheckReason: z.string().nullable() })), nextCursor: z.string().nullable(),
  }) },
  'xopc.settings.open': { input: z.strictObject({
    section: z.string().trim().regex(/^[a-z0-9][a-z0-9/_-]*$/i).max(512).default('overview'),
    title: z.string().trim().min(1).max(512).default('Settings'), summary: z.string().trim().max(4096).optional(),
  }), output: z.object({ ok: z.literal(true), settings: z.object({ section: z.string(), title: z.string(), summary: z.string().optional() }) }) },
  'xopc.local_apps.list': { input: z.strictObject({}), output: z.object({ apps: z.array(LocalAppRecordSchema) }) },
  'xopc.local_apps.get': { input: CapabilityResourceInputSchema, output: z.object({ app: LocalAppDetailSchema }) },
  'xopc.local_apps.validate': { input: CapabilityResourceInputSchema, output: z.object({ validation: LocalAppValidationSchema }) },
  'xopc.projects.get': { input: CapabilityResourceInputSchema, output: z.object({ ok: z.literal(true), project: ProjectRecordSchema }) },
  'xopc.projects.list': { input: ProjectListInputSchema, output: z.looseObject({ ok: z.literal(true), items: z.array(ProjectRecordSchema), total: z.number().int().nonnegative() }) },
  'xopc.projects.list_milestones': { input: CapabilityResourceInputSchema, output: z.object({ ok: z.literal(true), projectId: z.string(), items: z.array(ProjectMilestoneSchema) }) },
  'xopc.projects.list_updates': { input: CapabilityResourceInputSchema.extend({ limit: z.number().int().min(1).max(500).default(20) }),
    output: z.object({ ok: z.literal(true), projectId: z.string(), items: z.array(ProjectUpdateSchema) }) },
  'xopc.task_runs.get': { input: CapabilityResourceInputSchema, output: z.object({
    ok: z.literal(true), run: TaskRunSchema, receipt: TaskRunReceiptSchema.optional(),
    events: z.array(TaskRunEventSchema), activeWaits: z.array(TaskWaitSchema),
  }) },
  'xopc.task_runs.list': { input: z.strictObject({ taskId: z.string().trim().min(1), limit: z.number().int().min(1).max(200).default(20) }),
    output: z.object({ ok: z.literal(true), taskId: z.string(), items: z.array(TaskRunSchema),
      receipts: z.array(TaskRunReceiptSchema), activeWaits: z.array(TaskWaitSchema) }) },
  'xopc.notes.project_summaries': { input: z.strictObject({}), output: z.object({ items: z.array(z.object({
    id: z.string(), name: z.string(), description: z.string().optional(), noteCount: z.number().int().nonnegative(), updatedAt: z.number().optional(),
  })) }) },
  'xopc.notes.history': { input: CapabilityResourceInputSchema, output: z.object({ entries: z.array(z.object({
    timestamp: z.number().int().nonnegative(), trigger: z.enum(['edit', 'ai_edit', 'sync', 'restore']), snippet: z.string().optional(),
  })) }) },
  'xopc.notes.snapshot': { input: CapabilityResourceInputSchema.extend({ timestamp: z.number().int().nonnegative() }),
    output: z.object({ snapshot: z.object({ noteId: z.string(), timestamp: z.number().int().nonnegative(),
      trigger: z.enum(['edit', 'ai_edit', 'sync', 'restore']), title: z.string().optional(), markdown: z.string(), tags: z.array(z.string()).optional(),
      kind: NoteRecordSchema.shape.kind, status: NoteRecordSchema.shape.status,
    }) }) },
  'xopc.notes.get': { input: CapabilityResourceInputSchema, output: NoteGetOutputSchema },
  'xopc.notes.list': { input: NoteListInputSchema, output: NoteListOutputSchema },
  'xopc.tasks.metrics': { input: z.strictObject({}), output: z.object({ ok: z.literal(true), metrics: TaskValueMetricsSchema }) },
  'xopc.tasks.get': { input: CapabilityResourceInputSchema, output: TaskDetailResponseSchema },
  'xopc.tasks.list': { input: TaskListInputSchema, output: TaskListResponseSchema.extend({ total: z.number().int().nonnegative() }) },
} as const;

export type ProductReadId = keyof typeof ProductReadContracts;
export type ProductReadInput<K extends ProductReadId> = z.input<(typeof ProductReadContracts)[K]['input']>;
export type ProductReadOutput<K extends ProductReadId> = z.output<(typeof ProductReadContracts)[K]['output']>;
