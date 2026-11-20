import { z } from 'zod';
import {
  NoteCaptureInputSchema, NoteCreateInputSchema, NoteListInputSchema, NoteUpdateInputSchema,
  ProjectCreateInputSchema, ProjectEditInputSchema, ProjectListInputSchema, ProductReadContracts,
  TaskCreateRequestSchema, TaskDependencySummarySchema, TaskListInputSchema, TaskPatchRequestSchema,
  TaskRunReceiptSchema, TaskRunSchema,
  type GatewayScope,
} from '@xopcai/gateway-contract';

import type { CapabilityDispatcher } from '../capabilities/runtime/dispatcher.js';
import {
  LocalAppAutomationHistorySchema, LocalAppAutomationListSchema, LocalAppAutomationOutputSchema, LocalAppAutomationRunOutputSchema,
  LocalAppMilestoneOutputSchema, LocalAppMilestonesSchema, LocalAppNoteListSchema, LocalAppNoteOutputSchema,
  LocalAppProgressOutputSchema, LocalAppProjectListSchema, LocalAppProjectOutputSchema,
  LocalAppTaskEditSchema, LocalAppTaskListSchema, LocalAppTaskMutationSchema, LocalAppTaskOutputSchema,
  LocalAppTaskSchema, LocalAppUpdatesSchema,
} from '../local-apps/capabilities/projections.js';

import { mcpDelegationTools, registerMcpDelegation, type McpDelegationDeps } from './delegation.js';
import { registerWorkspaceSearch, WorkspaceSearchOutput } from './workspace-search.js';

type ProductTool = { scope: GatewayScope; input?: z.ZodType; output: z.ZodType; description?: string };

const listLimit = z.number().int().min(1).max(100).default(25);
const { name, description, outcome, successCriteria, nonGoals, health, targetAt } = ProjectCreateInputSchema.shape;
const projectFields = { name, description, outcome, successCriteria, nonGoals, health, targetAt };
const projectEdit = ProjectEditInputSchema.extend({
  patch: z.strictObject({
    ...projectFields,
    status: ProjectEditInputSchema.shape.patch.shape.status,
  }).refine(patch => Object.keys(patch).length > 0, 'Empty project patch'),
});
const notePatch = NoteUpdateInputSchema.shape.patch.pick({
  title: true, markdown: true, tags: true, pinned: true, kind: true, status: true,
}).refine(patch => Object.keys(patch).length > 0, 'Empty note patch');
const taskModel = LocalAppTaskOutputSchema.extend({
  task: LocalAppTaskSchema.extend({
    projectId: z.string().optional(), parentTaskId: z.string().optional(), milestoneId: z.string().optional(),
  }),
});
const projectDetail = LocalAppProjectOutputSchema.extend({
  project: LocalAppProjectOutputSchema.shape.project.extend({
    brief: z.string().optional(), successCriteria: z.array(z.string()), nonGoals: z.array(z.string()),
    pinned: z.boolean().optional(),
  }),
});
const taskEdit = LocalAppTaskEditSchema.extend({ task: taskModel.shape.task });
const taskMutation = z.discriminatedUnion('ok', [
  LocalAppTaskMutationSchema.options[0].extend({ model: taskModel.omit({ ok: true }) }),
  LocalAppTaskMutationSchema.options[1].extend({ model: taskModel.omit({ ok: true }).optional() }),
]);
const taskSummary = taskModel.omit({ ok: true }).extend({ task: taskModel.shape.task.omit({ body: true }) });
const { objective, expectedOutputs, acceptanceCriteria, constraints, acceptancePolicy } = TaskCreateRequestSchema.shape.contract.shape;
const taskCreate = TaskCreateRequestSchema.omit({
  idempotencyKey: true, activation: true, context: true, authorityGrants: true,
  originConversationId: true, delegateAgentId: true, ownerId: true, contract: true,
}).extend({
  contract: z.strictObject({
    objective: objective.trim().min(1).max(50_000), expectedOutputs: expectedOutputs.default([]),
    acceptanceCriteria: acceptanceCriteria.default([]), constraints: constraints.default([]), acceptancePolicy,
  }),
  activation: z.strictObject({ mode: z.literal('capture'), phase: z.enum(['backlog', 'ready']).default('backlog') })
    .default({ mode: 'capture', phase: 'backlog' }),
}).transform(input => ({
  ...input,
  contract: { ...input.contract, approvalRequired: [], assumptions: [], risks: [], outputDestinations: [] },
}));

const runFields = TaskRunSchema.shape;
const taskRun = z.object({
  id: runFields.id, taskId: runFields.taskId, status: runFields.status, executorKind: runFields.executorKind,
  attempt: runFields.attempt, queuedAt: runFields.queuedAt, startedAt: runFields.startedAt,
  completedAt: runFields.completedAt, terminalCode: runFields.terminalCode, version: runFields.version,
});
const taskRunReceipt = TaskRunReceiptSchema.pick({
  runId: true, status: true, summary: true, needsUser: true, completionVerdict: true, finalizedAt: true,
});

const productTools = {
  ...mcpDelegationTools,
  'xopc.projects.list': { scope: 'workspace.read', input: ProjectListInputSchema.extend({ limit: listLimit }), output: LocalAppProjectListSchema },
  'xopc.projects.get': { scope: 'workspace.read', output: projectDetail, description: 'Read project planning details and its version by ID.' },
  'xopc.projects.list_milestones': { scope: 'workspace.read', output: LocalAppMilestonesSchema },
  'xopc.projects.list_updates': { scope: 'workspace.read',
    input: ProductReadContracts['xopc.projects.list_updates'].input.extend({ limit: listLimit }), output: LocalAppUpdatesSchema },
  'xopc.projects.create': { scope: 'workspace.write', input: z.strictObject({ ...projectFields, name: name.unwrap() }),
    output: LocalAppProjectOutputSchema, description: 'Create a project with its name and optional planning metadata.' },
  'xopc.projects.update': { scope: 'workspace.write', input: projectEdit, output: LocalAppProjectOutputSchema,
    description: 'Edit project planning metadata at an exact version.' },
  'xopc.projects.set_pinned': { scope: 'workspace.write', output: LocalAppProjectOutputSchema },
  'xopc.projects.create_milestone': { scope: 'workspace.write', output: LocalAppMilestoneOutputSchema },
  'xopc.projects.update_milestone': { scope: 'workspace.write', output: LocalAppMilestoneOutputSchema },
  'xopc.projects.create_update': { scope: 'workspace.write', output: LocalAppProgressOutputSchema },
  'xopc.notes.list': { scope: 'workspace.read', input: NoteListInputSchema.extend({ limit: listLimit }), output: LocalAppNoteListSchema },
  'xopc.notes.get': { scope: 'workspace.read', output: LocalAppNoteOutputSchema },
  'xopc.notes.history': { scope: 'workspace.read', output: ProductReadContracts['xopc.notes.history'].output },
  'xopc.notes.snapshot': { scope: 'workspace.read', output: ProductReadContracts['xopc.notes.snapshot'].output },
  'xopc.notes.project_summaries': { scope: 'workspace.read', output: ProductReadContracts['xopc.notes.project_summaries'].output },
  'xopc.notes.create': { scope: 'workspace.write', input: NoteCreateInputSchema.omit({ capturedVia: true }), output: LocalAppNoteOutputSchema },
  'xopc.notes.capture': { scope: 'workspace.write', input: NoteCaptureInputSchema.omit({ capturedVia: true }), output: LocalAppNoteOutputSchema },
  'xopc.notes.append': { scope: 'workspace.write', output: LocalAppNoteOutputSchema },
  'xopc.notes.update': { scope: 'workspace.write', input: NoteUpdateInputSchema.omit({ trigger: true }).extend({ patch: notePatch }), output: LocalAppNoteOutputSchema },
  'xopc.notes.restore': { scope: 'workspace.write', output: LocalAppNoteOutputSchema },
  'xopc.tasks.list': { scope: 'tasks.read', input: TaskListInputSchema.extend({ limit: listLimit }),
    output: LocalAppTaskListSchema.extend({ items: z.array(taskSummary) }) },
  'xopc.tasks.get': { scope: 'tasks.read', output: taskModel.extend({
    dependencies: z.array(TaskDependencySummarySchema), dependents: z.array(TaskDependencySummarySchema),
  }), description: 'Read a task, its project references, version, operational state and dependencies.' },
  'xopc.tasks.create': { scope: 'tasks.write', input: taskCreate, output: taskMutation,
    description: 'Capture a task in backlog or ready with an objective; no execution is started.' },
  'xopc.tasks.update': { scope: 'tasks.write',
    input: TaskPatchRequestSchema.omit({ ownerId: true }).extend({ taskId: z.string().min(1) }), output: taskEdit },
  'xopc.tasks.reorder': { scope: 'tasks.write', output: taskEdit },
  'xopc.tasks.update_dependencies': { scope: 'tasks.write', output: taskEdit.extend({
    dependencies: z.array(TaskDependencySummarySchema), dependents: z.array(TaskDependencySummarySchema),
  }) },
  'xopc.task_runs.list': { scope: 'tasks.read',
    input: ProductReadContracts['xopc.task_runs.list'].input.extend({ limit: listLimit }),
    output: z.object({ ok: z.literal(true), taskId: z.string(), items: z.array(taskRun) }),
    description: 'List run IDs and execution status for a task.' },
  'xopc.task_runs.get': { scope: 'tasks.read',
    output: z.object({ ok: z.literal(true), run: taskRun, receipt: taskRunReceipt.optional() }),
    description: 'Read a task run’s status and its finalized result summary.' },
  'xopc.workspace.search': { scope: 'workspace.read', output: WorkspaceSearchOutput },
  'xopc.automations.list': { scope: 'automations.read', output: LocalAppAutomationListSchema },
  'xopc.automations.get': { scope: 'automations.read', output: LocalAppAutomationOutputSchema },
  'xopc.automations.get_run': { scope: 'automations.read',
    input: ProductReadContracts['xopc.automations.get_run'].input.omit({ waitMs: true }), output: LocalAppAutomationRunOutputSchema,
    description: 'Read the status and summary of one automation run by ID.' },
  'xopc.automations.history': { scope: 'automations.read', output: LocalAppAutomationHistorySchema },
} satisfies Record<string, ProductTool>;

export function registerMcpProductTools(dispatcher: CapabilityDispatcher, delegation: McpDelegationDeps): void {
  registerMcpDelegation(dispatcher, delegation);
  registerWorkspaceSearch(dispatcher);
  for (const [id, tool] of Object.entries(productTools)) dispatcher.exposeToMcp(id, tool);
}

export function isMcpProductTool(id: string): boolean {
  return Object.hasOwn(productTools, id);
}

export function listMcpProductTools(includeWrites: boolean): string[] {
  return Object.entries(productTools)
    .filter(([, tool]) => includeWrites || tool.scope.endsWith('.read'))
    .map(([id]) => id);
}

export function mcpProductScopes(ids: readonly string[]): GatewayScope[] {
  return [...new Set(ids.filter(isMcpProductTool).map(id => productTools[id as keyof typeof productTools].scope))];
}
