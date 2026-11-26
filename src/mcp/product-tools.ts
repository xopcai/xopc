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
import { mcpSessionTools, registerSessionTools } from './session-tools.js';
import { mcpUserContextTools, registerUserContextTools } from './user-context-tools.js';
import { mcpFileTools, registerWorkspaceFiles } from './workspace-files.js';
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
  ...mcpFileTools,
  ...mcpSessionTools,
  ...mcpUserContextTools,
  'xopc.projects.list': { scope: 'workspace.read', input: ProjectListInputSchema.extend({ limit: listLimit }), output: LocalAppProjectListSchema },
  'xopc.projects.get': { scope: 'workspace.read', output: projectDetail, description: 'Read project planning details and its version by ID.' },
  'xopc.projects.list_milestones': { scope: 'workspace.read', output: LocalAppMilestonesSchema },
  'xopc.projects.list_updates': {
    scope: 'workspace.read',
    input: ProductReadContracts['xopc.projects.list_updates'].input.extend({ limit: listLimit }),
    output: LocalAppUpdatesSchema,
  },
  'xopc.projects.create': {
    scope: 'workspace.write', input: z.strictObject({ ...projectFields, name: name.unwrap() }),
    output: LocalAppProjectOutputSchema, description: 'Create a project with its name and optional planning metadata.',
  },
  'xopc.projects.update': {
    scope: 'workspace.write', input: projectEdit, output: LocalAppProjectOutputSchema,
    description: 'Edit project planning metadata at an exact version.',
  },
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
  'xopc.tasks.list': {
    scope: 'tasks.read', input: TaskListInputSchema.extend({ limit: listLimit }),
    output: LocalAppTaskListSchema.extend({ items: z.array(taskSummary) }),
  },
  'xopc.tasks.get': {
    scope: 'tasks.read', output: taskModel.extend({
      dependencies: z.array(TaskDependencySummarySchema), dependents: z.array(TaskDependencySummarySchema),
    }), description: 'Read a task, its project references, version, operational state and dependencies.',
  },
  'xopc.tasks.create': {
    scope: 'tasks.write', input: taskCreate, output: taskMutation,
    description: 'Capture a task in backlog or ready with an objective; no execution is started.',
  },
  'xopc.tasks.update': {
    scope: 'tasks.write',
    input: TaskPatchRequestSchema.omit({ ownerId: true }).extend({ taskId: z.string().min(1) }), output: taskEdit,
  },
  'xopc.tasks.reorder': { scope: 'tasks.write', output: taskEdit },
  'xopc.tasks.update_dependencies': {
    scope: 'tasks.write', output: taskEdit.extend({
      dependencies: z.array(TaskDependencySummarySchema), dependents: z.array(TaskDependencySummarySchema),
    }),
  },
  'xopc.tasks.add_context': { scope: 'tasks.write', output: z.record(z.string(), z.unknown()) },
  'xopc.tasks.remove_context': { scope: 'tasks.write', output: z.record(z.string(), z.unknown()) },
  'xopc.task_runs.list': {
    scope: 'tasks.read',
    input: ProductReadContracts['xopc.task_runs.list'].input.extend({ limit: listLimit }),
    output: z.object({ ok: z.literal(true), taskId: z.string(), items: z.array(taskRun) }),
    description: 'List run IDs and execution status for a task.',
  },
  'xopc.task_runs.get': {
    scope: 'tasks.read',
    output: z.object({ ok: z.literal(true), run: taskRun, receipt: taskRunReceipt.optional() }),
    description: 'Read a task run’s status and its finalized result summary.',
  },
  'xopc.task_runs.feedback': {
    scope: 'tasks.write',
    output: z.record(z.string(), z.unknown()),
    description: 'Record structured user/reviewer feedback for a completed task run.',
  },
  'xopc.workspace.search': { scope: 'workspace.read', output: WorkspaceSearchOutput },
  'xopc.automations.list': { scope: 'automations.read', output: LocalAppAutomationListSchema },
  'xopc.automations.get': { scope: 'automations.read', output: LocalAppAutomationOutputSchema },
  'xopc.automations.get_run': {
    scope: 'automations.read',
    input: ProductReadContracts['xopc.automations.get_run'].input.omit({ waitMs: true }), output: LocalAppAutomationRunOutputSchema,
    description: 'Read the status and summary of one automation run by ID.',
  },
  'xopc.automations.history': { scope: 'automations.read', output: LocalAppAutomationHistorySchema },
  'xopc.automations.simulate': {
    scope: 'automations.read',
    output: z.record(z.string(), z.unknown()),
    description: 'Simulate an automation schedule or trigger rule without installing or executing it.',
  },
  'xopc.automations.draft': {
    scope: 'automations.write',
    output: z.record(z.string(), z.unknown()),
    description: 'Create an automation draft for user review; does not install or run the automation.',
  },
} satisfies Record<string, ProductTool>;

export type McpProductToolId = keyof typeof productTools;

export interface McpToolsetDefinition {
  id: string;
  label: string;
  description: string;
  includesWrite: boolean;
  capabilityIds: readonly McpProductToolId[];
}

export const MCP_TOOLSETS: readonly McpToolsetDefinition[] = [
  {
    id: 'core-read',
    label: 'Core Workspace Read',
    description: 'Search and read projects, tasks, notes, and workspace files.',
    includesWrite: false,
    capabilityIds: [
      'xopc.workspace.search',
      'xopc.projects.list', 'xopc.projects.get', 'xopc.projects.list_milestones', 'xopc.projects.list_updates',
      'xopc.notes.list', 'xopc.notes.get', 'xopc.notes.history', 'xopc.notes.snapshot', 'xopc.notes.project_summaries',
      'xopc.tasks.list', 'xopc.tasks.get', 'xopc.task_runs.list', 'xopc.task_runs.get',
      'xopc.sessions.list', 'xopc.sessions.search', 'xopc.sessions.read',
      'xopc.files.spaces', 'xopc.files.list', 'xopc.files.search', 'xopc.files.get',
    ],
  },
  {
    id: 'memory-read',
    label: 'User Context & Knowledge Memory',
    description: 'Read user profile, active goals, collaboration rules, past sessions, and non-sensitive knowledge memory.',
    includesWrite: false,
    capabilityIds: [
      'xopc.user_context.profile', 'xopc.knowledge.list', 'xopc.knowledge.search',
      'xopc.sessions.list', 'xopc.sessions.search', 'xopc.sessions.read',
      'xopc.workspace.search',
    ],
  },
  {
    id: 'workspace-write',
    label: 'Workspace Read & Write',
    description: 'Core workspace read plus creating/updating projects, notes, and tasks.',
    includesWrite: true,
    capabilityIds: [
      'xopc.workspace.search',
      'xopc.projects.list', 'xopc.projects.get', 'xopc.projects.list_milestones', 'xopc.projects.list_updates',
      'xopc.projects.create', 'xopc.projects.update', 'xopc.projects.set_pinned',
      'xopc.projects.create_milestone', 'xopc.projects.update_milestone', 'xopc.projects.create_update',
      'xopc.notes.list', 'xopc.notes.get', 'xopc.notes.history', 'xopc.notes.snapshot', 'xopc.notes.project_summaries',
      'xopc.notes.create', 'xopc.notes.capture', 'xopc.notes.append', 'xopc.notes.update', 'xopc.notes.restore',
      'xopc.tasks.list', 'xopc.tasks.get', 'xopc.tasks.create', 'xopc.tasks.update', 'xopc.tasks.reorder',
      'xopc.tasks.update_dependencies', 'xopc.tasks.add_context', 'xopc.tasks.remove_context',
      'xopc.task_runs.list', 'xopc.task_runs.get', 'xopc.task_runs.feedback',
      'xopc.sessions.list', 'xopc.sessions.search', 'xopc.sessions.read',
      'xopc.files.spaces', 'xopc.files.list', 'xopc.files.search', 'xopc.files.get',
    ],
  },
  {
    id: 'delegation',
    label: 'Agent Delegation',
    description: 'Discover xopc Agents, delegate tasks, stream events, steer, answer clarifications, and read artifacts.',
    includesWrite: true,
    capabilityIds: [
      'xopc.agent_runs.agents', 'xopc.agent_runs.list', 'xopc.agent_runs.start', 'xopc.agent_runs.get',
      'xopc.agent_runs.result', 'xopc.agent_runs.artifact_read', 'xopc.agent_runs.events',
      'xopc.agent_runs.respond', 'xopc.agent_runs.steer', 'xopc.agent_runs.cancel',
      'xopc.workspace.search', 'xopc.files.spaces', 'xopc.files.search', 'xopc.files.get',
    ],
  },
  {
    id: 'automations',
    label: 'Automations Inspect & Draft',
    description: 'Inspect automation rules/history, simulate triggers, and propose drafts without installing.',
    includesWrite: true,
    capabilityIds: [
      'xopc.automations.list', 'xopc.automations.get', 'xopc.automations.get_run',
      'xopc.automations.history', 'xopc.automations.simulate', 'xopc.automations.draft',
    ],
  },
];

export function resolveMcpToolsetCapabilities(toolsetId: string, includeWrites?: boolean): string[] | undefined {
  if (toolsetId === 'full-read') return listMcpProductTools(false);
  if (toolsetId === 'full-write') return listMcpProductTools(true);
  const preset = MCP_TOOLSETS.find(item => item.id === toolsetId);
  if (!preset) return undefined;
  const ids = [...preset.capabilityIds];
  if (includeWrites === false) {
    return ids.filter(id => productTools[id].scope.endsWith('.read'));
  }
  return ids;
}

export function registerMcpProductTools(dispatcher: CapabilityDispatcher, delegation: McpDelegationDeps): void {
  registerMcpDelegation(dispatcher, delegation);
  registerWorkspaceFiles(dispatcher, delegation.getFiles);
  registerSessionTools(dispatcher, delegation.getConfig);
  registerUserContextTools(dispatcher);
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
