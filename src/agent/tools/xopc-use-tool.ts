import type { SceneAccess } from '../../scenes/httpServices.js';
import { randomUUID } from 'node:crypto';
import { createProductDispatcher } from '../../capabilities/runtime/product.js';
import { localAppCapabilities } from '../../local-apps/capabilities/runtime.js';
import { CapabilityCallSchema } from '@xopcai/gateway-contract';
import { CapabilityError, type CapabilityContext, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import { TaskMutationOutputSchema } from '../../tasks/capabilities/write.js';
import { TaskDeleteOutputSchema } from '../../tasks/capabilities/management.js';
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  appendProductDeliveryText,
  ChatPreviewCreateInputSchema,
  ChatPreviewReviseInputSchema,
  PRODUCT_DELIVERY_VERSION,
  AutomationMutationOutputSchema,
  AutomationRunMutationOutputSchema,
  AutomationCancelOutputSchema,
  AutomationReadOutputSchema,
  AutomationReadAllOutputSchema,
  AutomationReadAllInputSchema,
  CapabilityResourceInputSchema,
  AutomationDeleteOutputSchema,
  NoteGetOutputSchema,
  NoteDeleteOutputSchema,
  TaskContextInputSchema,
  type TaskCommand,
  TaskCommandSchema,
  TaskRunCancelInputSchema,
  TaskRunCancelOutputSchema,
  TaskRunFeedbackInputSchema, TaskRunFeedbackOutputSchema,
  ProjectCreateInputSchema, ProjectEditInputSchema, ProjectDeleteInputSchema, ProjectDeleteOutputSchema, ProjectSetPinnedInputSchema, ProjectMutationOutputSchema, ProjectMilestoneCreateInputSchema, ProjectMilestoneUpdateInputSchema, ProjectMilestoneDeleteInputSchema,
  ProjectMilestoneOutputSchema, ProjectMilestoneDeleteOutputSchema, ProjectUpdateCreateInputSchema, ProjectUpdateOutputSchema,
  ProjectResolveWorkspaceInputSchema, ProjectResolveWorkspaceOutputSchema,
  SceneWriteContracts,
  type TaskPriority,
  type ProductDeliveryEnvelope,
  type ProductReference,
} from '@xopcai/gateway-contract';

import { runWithActivityContext } from '../../activity/index.js';
import type { AutomationService } from '../../automations/index.js';
import { AutomationCreateCapabilityInputSchema, AutomationUpdatePatchSchema } from '../../automations/capabilities/write.js';
import type { Config } from '../../config/schema.js';
import type { NoteKind, NotesService, NoteStatus } from '../../notes/index.js';
import {
  resolveProjectAgentId,
  type ProjectService,
} from '../../projects/index.js';
import type { LocalAppService } from '../../local-apps/index.js';
import type { ChatPreviewService } from '../../chat-previews/index.js';
import { getDefaultAgentId } from '../../routing/resolve-route.js';
import { getSessionMetadata } from '../../storage/sqlite/index.js';
import {
  defineTaskContract,
  TaskRepository,
  TaskRunRepository,
} from '../../tasks/index.js';
import { TaskDeletionService } from '../../tasks/task-deletion-service.js';

const XopcUseToolSchema = Type.Object({
  mode: Type.Union([
    Type.Literal('context'),
    Type.Literal('scene'),
    Type.Literal('project'),
    Type.Literal('automation'),
    Type.Literal('note'),
    Type.Literal('task'),
    Type.Literal('task_run'),
    Type.Literal('local_app'),
    Type.Literal('chat_preview'),
    Type.Literal('settings'),
  ]),
  command: Type.String({
    description:
      'Context resolve takes an explicit AppContextEnvelope; never guess a current page. Automation draft/repair_draft accept prompt/id, agentId?, language?, idempotencyKey?; simulate explains an automation without running it. Local_app record_acceptance records supplied checks and sourceHash, not proof that checks were executed. ' +
      'Project create accepts idempotencyKey; update/pin/unpin/delete accepts {projectId, expectedVersion?, idempotencyKey?}; stable retries require the original expectedVersion. Delete preserves workspace files and does not confirm external execution stopped. ' +
      'Project milestone writes support idempotencyKey; update_milestone/delete_milestone require original expectedRevision for stable retries, and create_update requires original expectedVersion. TaskRun cancel accepts idempotencyKey and expectedVersion, and does not confirm external execution stopped. ' +
      'Automation diagnostics: get_run/run_events {runId}, metrics {}, product_events {eventType, source?, payloadKey?, payloadValue?, limit?}; payload filters require both key and value. ' +
      'Automation also supports cancel/read {runId, idempotencyKey?} and read_all {projectId?, idempotencyKey?}; omitted projectId means all projects. Cancel acceptance is not confirmation of stopping. ' +
      'Object command. Scene commands: templates, list, get {id}, mail_accounts, mail_search {accountId, query}, mail_sources, read_notes {id}, preflight/start {templateKey, templateVersion, goal, scope, permissions}, configure {id, expectedRevision, goal, scope, permissions}, transition {id, expectedRevision, status: paused|active|completed|archived}, check {id}, notes {id, expectedRevision, content, validUntil?}, work_item {id, subjectId, accountId, dueAt}, update_work_item {workItemId, expectedRevision, dueAt?, status?}, schedule {id, triggerKey, expectedRevision, schedule}, results {id?}, feedback {presentationId, expectedRevision, rating}, mark_read {presentationId, read}, diagnostics, get_preferences, set_preferences {expectedRevision, ...preferences}. Start and check accept a stable requestId for retries. Scenes prepare read-only suggestions and drafts; never send mail. Only create a scene for work explicitly delegated by the user; inspect existing scenes first. Supports project list/get/create/update/resolve_workspace/list_milestones/create_milestone/update_milestone/list_updates/create_update, automation list/get/create/update/delete/run/rerun/pause/resume/history (rerun takes runId; run/rerun accept idempotencyKey), note list/get/project_summaries/history {noteId}/snapshot {noteId, timestamp}/create/append/update/preview_edit/delete, task list/get/create/update_dependencies/add_context/remove_context/command/delete, task_run list/get/cancel, chat_preview create/revise/get, local_app list/get/create/validate, and settings open.',
  }),
  args: Type.Optional(Type.Record(Type.String(), Type.Any())),
  dryRun: Type.Optional(Type.Boolean({
    description: 'Validate and preview the action without mutating xopc state.',
  })),
});

export type XopcUseMode = 'context' | 'scene' | 'project' | 'automation' | 'note' | 'task' | 'task_run' | 'chat_preview' | 'local_app' | 'settings';

export interface XopcUseToolInput {
  mode: XopcUseMode;
  command: string;
  args?: Record<string, unknown>;
  dryRun?: boolean;
}

export interface XopcUseToolDeps {
  authorizeCapability?: CapabilityContext['authorize'];
  getWorkspace?: () => string;
  getConfig?: () => Config | undefined;
  getCurrentAgentId?: () => string | undefined;
  getCurrentConversationId?: () => string | undefined;
  getAutomationService?: () => AutomationService | undefined;
  getSceneAccess?: () => SceneAccess | undefined;
  getNotesService?: () => NotesService | undefined;
  getProjectService?: () => ProjectService | undefined;
  getWorkDiscovery?: () => import('../../work-discovery/service.js').WorkDiscoveryService | undefined;
  getLocalAppService?: () => LocalAppService | undefined;
  getChatPreviewService?: () => ChatPreviewService | undefined;
  dispatchTaskEvents?: () => void;
  dispatchTaskRuns?: () => void;
}

type XopcUseDetails = {
  mode: XopcUseMode;
  command: string;
  dryRun: boolean;
  result?: unknown;
  delivery?: ProductDeliveryEnvelope;
};

const NOTE_KINDS = new Set<NoteKind>(['thought', 'todo', 'voice', 'media', 'bookmark', 'mixed', 'task']);
const NOTE_STATUSES = new Set<NoteStatus>(['inbox', 'processed', 'archived', 'trashed']);
const TASK_PRIORITIES = new Set<TaskPriority>(['low', 'normal', 'high', 'critical']);
const TASK_COMMANDS = new Set<TaskCommand['type']>([
  'mark_ready', 'start', 'request_review', 'close', 'reopen',
  'add_wait', 'resolve_wait', 'revise_contract',
]);
const TASK_CREATE_MODES = new Set(['capture', 'start'] as const);

function okText(details: XopcUseDetails): AgentToolResult<XopcUseDetails> {
  const text = JSON.stringify(details.result ?? {}, null, 2);
  return {
    content: [{ type: 'text', text: appendProductDeliveryText(text, details.delivery) }],
    details,
  };
}

function errorText(message: string, details: XopcUseDetails): AgentToolResult<XopcUseDetails> {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    details: { ...details, result: { ok: false, error: message } },
  };
}

function trimString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  return undefined;
}

function enumValue<T extends string>(value: unknown, allowed: Set<T>): T | undefined {
  return typeof value === 'string' && allowed.has(value as T) ? value as T : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}


function ensureArgs(input: XopcUseToolInput): Record<string, unknown> {
  return input.args && typeof input.args === 'object' && !Array.isArray(input.args) ? input.args : {};
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function deliveryText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function deliveryRevision(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return deliveryText(value);
}

function deliverySummary(...values: unknown[]): string | undefined {
  const value = values.map(deliveryText).find(Boolean);
  if (!value) return undefined;
  return value.length > 180 ? `${value.slice(0, 177)}…` : value;
}

function deliveryForXopcResult(
  mode: XopcUseMode,
  command: string,
  result: unknown,
  dryRun: boolean,
): ProductDeliveryEnvelope | undefined {
  if (dryRun || command === 'delete') return undefined;
  const resultRecord = record(result);
  if (!resultRecord || resultRecord.ok === false) return undefined;
  if (command === 'list') {
    const rows = resultRecord.items ?? resultRecord.activations ?? resultRecord.apps;
    if (!Array.isArray(rows) || !['task', 'note', 'project', 'automation', 'scene', 'local_app'].includes(mode)) return undefined;
    const field = mode === 'scene' ? 'activation' : mode === 'local_app' ? 'app' : mode;
    const items = rows.slice(0, 50).flatMap(row => {
      const reference = deliveryForXopcResult(mode, 'get', { [field]: row }, false)?.primary;
      return reference ? [{ ...reference, capabilities: ['open' as const] }] : [];
    });
    return { version: PRODUCT_DELIVERY_VERSION, operation: 'opened', presentation: { kind: 'table', items,
      truncated: rows.length > 50 || Boolean(resultRecord.nextCursor) || (typeof resultRecord.total === 'number' && resultRecord.total > items.length) } };
  }
  if (mode === 'note' && command === 'preview_edit') {
    const patch = record(resultRecord.patch);
    if (!patch || !Array.isArray(patch.operations)) return undefined;
    let remaining = 16000;
    let truncated = patch.operations.length > 20;
    const edits = patch.operations.slice(0, 20).flatMap(value => {
      const edit = record(value);
      if (!edit || edit.type !== 'replaceRange' || !Number.isSafeInteger(edit.from) || !Number.isSafeInteger(edit.to)
        || (edit.from as number) < 0 || (edit.to as number) < (edit.from as number) || typeof edit.markdown !== 'string') return [];
      const text = edit.markdown.slice(0, remaining);
      truncated ||= text.length < edit.markdown.length;
      remaining -= text.length;
      return [{ from: edit.from as number, to: edit.to as number, text }];
    });
    return { version: PRODUCT_DELIVERY_VERSION, operation: 'opened', presentation: { kind: 'diff',
      title: String(patch.summary ?? '').slice(0, 2000), edits, truncated } };
  }

  let source: Record<string, unknown> | undefined;
  let primary: ProductReference | undefined;
  if (mode === 'project') {
    const match = record(resultRecord.match);
    source = record(resultRecord.project) ?? record(match?.project) ?? match;
    const id = deliveryText(source?.id);
    if (id) {
      primary = {
        kind: 'project',
        id,
        title: deliveryText(source?.name) ?? 'Project',
        summary: deliverySummary(source?.description, source?.brief),
        status: deliveryText(source?.status),
        revision: deliveryRevision(source?.version),
        capabilities: ['open', 'edit', 'continue_in_chat'],
      };
    }
  } else if (mode === 'automation') {
    source = record(resultRecord.automation);
    const id = deliveryText(source?.id);
    if (id) {
      const enabled = source?.enabled === true;
      primary = {
        kind: 'automation',
        id,
        title: deliveryText(source?.name) ?? 'Automation',
        summary: deliverySummary(source?.description),
        status: enabled ? 'enabled' : 'paused',
        revision: deliveryRevision(source?.updatedAtMs),
        projectId: deliveryText(source?.projectId),
        capabilities: ['open', 'edit', 'continue_in_chat', 'run', enabled ? 'pause' : 'resume'],
      };
    }
  } else if (mode === 'scene') {
    source = record(resultRecord.activation);
    const id = deliveryText(source?.id);
    if (id) {
      primary = {
        kind: 'scene',
        id,
        title: deliveryText(source?.goal) ?? 'Scene',
        status: deliveryText(source?.status),
        revision: deliveryRevision(source?.revision),
        capabilities: ['open', 'edit', 'continue_in_chat'],
      };
    }
  } else if (mode === 'note') {
    source = record(resultRecord.note);
    const id = deliveryText(source?.id);
    if (id) {
      primary = {
        kind: 'note',
        id,
        title: deliveryText(source?.title) ?? 'Untitled note',
        summary: deliverySummary(source?.markdown),
        status: deliveryText(source?.status),
        revision: deliveryRevision(source?.remoteVersion ?? 1),
        projectId: deliveryText(resultRecord.projectId),
        capabilities: ['open', 'preview', 'edit', 'continue_in_chat', 'share'],
      };
    }
  } else if (mode === 'task') {
    source = record(resultRecord.task);
    const id = deliveryText(source?.id);
    if (id) {
      const phase = deliveryText(source?.phase);
      const operationalState = deliveryText(resultRecord.operationalState);
      const runCapability: ProductReference['capabilities'][number] | undefined =
        phase === 'ready' && (!operationalState || operationalState === 'idle') ? 'run' : undefined;
      primary = {
        kind: 'task',
        id,
        title: deliveryText(source?.title) ?? 'Task',
        status: operationalState ? `${phase}/${operationalState}` : phase,
        revision: deliveryRevision(source?.version) ?? deliveryRevision(source?.updatedAt),
        projectId: deliveryText(source?.projectId),
        capabilities: ['open', 'edit', 'continue_in_chat', ...(runCapability ? [runCapability] : [])],
      };
    }
  } else if (mode === 'task_run') {
    const run = record(resultRecord.run);
    const model = record(resultRecord.model);
    source = record(model?.task);
    const taskId = deliveryText(source?.id) ?? deliveryText(run?.taskId);
    if (taskId) {
      primary = {
        kind: 'task',
        id: taskId,
        title: deliveryText(source?.title) ?? 'Task',
        status: deliveryText(run?.status),
        revision: deliveryRevision(run?.version),
        projectId: deliveryText(source?.projectId),
        capabilities: ['open', 'continue_in_chat'],
      };
    }
  } else if (mode === 'local_app') {
    source = record(resultRecord.app);
    const snapshot = record(resultRecord.snapshot);
    const id = deliveryText(source?.id);
    if (id) {
      primary = {
        kind: 'local_app',
        id,
        title: deliveryText(source?.name) ?? 'Local app',
        summary: deliverySummary(source?.description, source?.idea),
        status: deliveryText(source?.installationState) ?? deliveryText(source?.status),
        revision: deliveryText(snapshot?.sourceHash),
        projectId: deliveryText(source?.projectId),
        capabilities: ['open', 'preview', 'edit', 'continue_in_chat', 'fix', 'run'],
      };
    }
  } else if (mode === 'chat_preview') {
    source = record(resultRecord.preview);
    const revision = record(resultRecord.revision);
    const id = deliveryText(source?.id);
    const sourceHash = deliveryText(revision?.sourceHash) ?? deliveryText(source?.latestRevision);
    if (id && sourceHash) {
      primary = {
        kind: 'chat_preview',
        id,
        title: deliveryText(source?.title) ?? 'Preview',
        status: 'preview_ready',
        revision: sourceHash,
        capabilities: ['preview', 'edit', 'continue_in_chat', 'fix'],
      };
    }
  } else if (mode === 'settings') {
    source = record(resultRecord.settings);
    const id = deliveryText(source?.section);
    if (id) {
      primary = {
        kind: 'settings',
        id,
        title: deliveryText(source?.title) ?? 'Settings',
        summary: deliverySummary(source?.summary),
        capabilities: ['open', 'configure', 'continue_in_chat'],
      };
    }
  }

  if (!primary) return undefined;
  const localAppSnapshotHash = mode === 'local_app'
    ? deliveryText(record(resultRecord.snapshot)?.sourceHash)
    : undefined;
  if (mode === 'local_app' && !localAppSnapshotHash) return undefined;
  const chatPreviewSourceHash = mode === 'chat_preview'
    ? deliveryText(record(resultRecord.revision)?.sourceHash) ?? deliveryText(record(resultRecord.preview)?.latestRevision)
    : undefined;
  if (mode === 'chat_preview' && !chatPreviewSourceHash) return undefined;
  return {
    version: PRODUCT_DELIVERY_VERSION,
    operation: (mode === 'task' && deliveryText(resultRecord.runId))
      || (mode === 'automation' && (command === 'run' || command === 'rerun'))
      || (mode === 'scene' && command === 'check')
      ? 'started'
      : command === 'create' || (mode === 'scene' && command === 'start')
      ? 'created'
      : command === 'get' || command === 'resolve_workspace' || mode === 'settings'
        ? 'opened'
        : command === 'validate'
          ? 'completed'
        : 'updated',
    primary,
    ...(mode === 'local_app' ? {
      presentation: {
        kind: 'inline_app' as const,
        reference: primary,
        snapshot: { sourceHash: localAppSnapshotHash! },
        preferredHeight: 480,
      },
    } : {}),
    ...(mode === 'chat_preview' ? {
      presentation: {
        kind: 'inline_preview' as const,
        reference: primary,
        sourceHash: chatPreviewSourceHash!,
        preferredHeight: Number(source?.preferredHeight) || 480,
      },
    } : {}),
  };
}

function currentProjectId(args: Record<string, unknown>, deps: XopcUseToolDeps): string | undefined {
  const explicit = trimString(args.projectId);
  if (explicit) return explicit;
  const conversationId = trimString(args.conversationId) ?? deps.getCurrentConversationId?.();
  return conversationId ? getSessionMetadata(conversationId)?.projectId : undefined;
}

function automationPayload(args: Record<string, unknown>, key: 'automation' | 'patch'): Record<string, unknown> {
  return record(args[key]) ?? args;
}

function pickDefined(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields
    .filter((field) => source[field] !== undefined)
    .map((field) => [field, source[field]]));
}

function automationProjectError(projectId: string | undefined, deps: XopcUseToolDeps): string | undefined {
  if (!projectId) return undefined;
  const projects = deps.getProjectService?.();
  if (!projects) return 'Project service is unavailable';
  return projects.get(projectId) ? undefined : `Project not found: ${projectId}`;
}

function projectWorkspaceRootArg(args: Record<string, unknown>): string | undefined {
  return trimString(args.workspaceRoot) ?? trimString(args.workspacePath) ?? trimString(args.path);
}

function optionalProjectWorkspaceRootArg(args: Record<string, unknown>): string | null | undefined {
  if (args.workspaceRoot !== undefined) return optionalString(args.workspaceRoot);
  if (args.workspacePath !== undefined) return optionalString(args.workspacePath);
  if (args.path !== undefined) return optionalString(args.path);
  return undefined;
}

async function handleProject(
  command: string,
  args: Record<string, unknown>,
  deps: XopcUseToolDeps,
  dryRun: boolean,
  capabilities: CapabilityDispatcher,
): Promise<unknown> {
  const projects = deps.getProjectService?.();
  if (!projects) return { ok: false, error: 'Project service is unavailable' };

  if (command === 'resolve_workspace') {
    if (args.idempotencyKey !== undefined && !trimString(args.idempotencyKey)) return { ok: false, error: 'Invalid idempotencyKey' };
    const input = ProjectResolveWorkspaceInputSchema.parse({
      ...pickDefined(args, ['agentId', 'defaultAgentId', 'projectKind', 'autoCreate', 'conversationId']),
      workspacePath: projectWorkspaceRootArg(args),
    });
    if (dryRun) return { ok: true, dryRun: true, action: 'resolve_project_workspace', input };
    const caller: CapabilityContext = { principalId: 'agent:' + (deps.getCurrentAgentId?.() ?? 'main'), surface: 'agent',
      scopes: ['workspace.write'], actor: { kind: 'agent', id: deps.getCurrentAgentId?.() }, authorize: deps.authorizeCapability ?? (() => true) };
    const operation = 'xopc.projects.resolve_workspace';
    const result = ProjectResolveWorkspaceOutputSchema.parse(await capabilities.call(operation, input, caller,
      { ...capabilities.describe(operation, caller), idempotencyKey: trimString(args.idempotencyKey) ?? randomUUID() }));
    const { ok: _ok, ...match } = result;
    return result.project ? { ok: true, match } : { ok: false, error: 'No project matched workspace path' };
  }

  if (command === 'create' || command === 'update') {
    const fields = ['name', 'description', 'defaultAgentId', 'createWorkspaceRoot', 'executionMode', 'brief', 'instructions',
      'outcome', 'successCriteria', 'scope', 'nonGoals', 'health', 'ownerId', 'targetAt'];
    const values = pickDefined(args, fields);
    const workspaceRoot = command === 'create' ? projectWorkspaceRootArg(args) : optionalProjectWorkspaceRootArg(args);
    if (workspaceRoot !== undefined) values.workspaceRoot = workspaceRoot;
    if (args.workspaceRoot !== undefined && typeof args.workspaceRoot !== 'string' && args.workspaceRoot !== null) values.workspaceRoot = args.workspaceRoot;
    if (args.idempotencyKey !== undefined && !trimString(args.idempotencyKey)) return { ok: false, error: 'Invalid idempotencyKey' };
    let input: unknown;
    if (command === 'create') {
      input = ProjectCreateInputSchema.parse({ ...values, ...pickDefined(args, ['projectKind', 'autoUnderstand']) });
    } else {
      const id = trimString(args.projectId) ?? trimString(args.id);
      if (!id) return { ok: false, error: 'projectId is required' };
      if (args.idempotencyKey !== undefined && args.expectedVersion === undefined) return { ok: false, error: 'Stable retries require the original expectedVersion' };
      const project = args.expectedVersion === undefined ? projects.get(id) : undefined;
      if (args.expectedVersion === undefined && !project) return { ok: false, error: 'Project not found' };
      input = ProjectEditInputSchema.parse({ id, expectedVersion: args.expectedVersion === undefined ? project?.version : args.expectedVersion,
        patch: { ...values, ...pickDefined(args, ['status']) } });
    }
    if (dryRun) return { ok: true, dryRun: true, action: `${command}_project`, input };
    const caller: CapabilityContext = { principalId: 'agent:' + (deps.getCurrentAgentId?.() ?? 'main'), surface: 'agent',
      scopes: ['workspace.write'], actor: { kind: 'agent', id: deps.getCurrentAgentId?.() }, authorize: deps.authorizeCapability ?? (() => true) };
    const operation = 'xopc.projects.' + command;
    return ProjectMutationOutputSchema.parse(await capabilities.call(operation, input, caller,
      { ...capabilities.describe(operation, caller), idempotencyKey: trimString(args.idempotencyKey) ?? randomUUID() }));
  }

  if (command === 'pin' || command === 'unpin' || command === 'delete') {
    const id = trimString(args.projectId) ?? trimString(args.id);
    if (!id) return { ok: false, error: 'projectId is required' };
    if (args.idempotencyKey !== undefined && !trimString(args.idempotencyKey)) return { ok: false, error: 'Invalid idempotencyKey' };
    if (args.idempotencyKey !== undefined && args.expectedVersion === undefined) return { ok: false, error: 'Stable retries require the original expectedVersion' };
    const project = args.expectedVersion === undefined ? projects.get(id) : undefined;
    if (args.expectedVersion === undefined && !project) return { ok: false, error: 'Project not found' };
    const common = { id, expectedVersion: args.expectedVersion === undefined ? project?.version : args.expectedVersion };
    const input = command === 'delete' ? ProjectDeleteInputSchema.parse(common)
      : ProjectSetPinnedInputSchema.parse({ ...common, pinned: command === 'pin' });
    if (dryRun) return { ok: true, dryRun: true, action: `${command}_project`, input };
    const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`, surface: 'agent',
      scopes: ['workspace.write'], actor: { kind: 'agent', id: deps.getCurrentAgentId?.() }, authorize: deps.authorizeCapability ?? (() => true) };
    const operation = command === 'delete' ? 'xopc.projects.delete' : 'xopc.projects.set_pinned';
    const result = await capabilities.call(operation, input, caller, { ...capabilities.describe(operation, caller), idempotencyKey: trimString(args.idempotencyKey) ?? randomUUID() });
    return (command === 'delete' ? ProjectDeleteOutputSchema : ProjectMutationOutputSchema).parse(result);
  }

  if (['create_milestone', 'update_milestone', 'delete_milestone', 'create_update'].includes(command)) {
    const projectId = trimString(args.projectId) ?? trimString(args.id);
    if (!projectId) return { ok: false, error: 'projectId is required' };
    const operation = 'xopc.projects.' + command;
    let input: unknown;
    if (command === 'create_milestone') {
      input = ProjectMilestoneCreateInputSchema.parse({ projectId, ...pickDefined(args, ['title', 'description', 'status', 'targetAt', 'sortOrder']) });
    } else if (command === 'create_update') {
      if (args.idempotencyKey !== undefined && args.expectedVersion === undefined) return { ok: false, error: 'Stable retries require the original expectedVersion' };
      input = ProjectUpdateCreateInputSchema.parse({ projectId, ...pickDefined(args, ['health', 'summary', 'progress', 'risks', 'nextSteps']),
        expectedVersion: args.expectedVersion === undefined ? projects.get(projectId)?.version : args.expectedVersion });
    } else {
      const id = trimString(args.milestoneId);
      if (args.idempotencyKey !== undefined && args.expectedRevision === undefined) return { ok: false, error: 'Stable retries require the original expectedRevision' };
      const expectedRevision = args.expectedRevision === undefined
        ? projects.listMilestones(projectId).find(item => item.id === id)?.updatedAt : args.expectedRevision;
      const common = { projectId, id, expectedRevision };
      input = command === 'delete_milestone' ? ProjectMilestoneDeleteInputSchema.parse(common)
        : ProjectMilestoneUpdateInputSchema.parse({ ...common, patch: pickDefined(args, ['title', 'description', 'status', 'targetAt', 'sortOrder']) });
    }
    if (dryRun) return { ok: true, dryRun: true, action: command, input };
    const caller: CapabilityContext = { principalId: 'agent:' + (deps.getCurrentAgentId?.() ?? 'main'), surface: 'agent',
      scopes: ['workspace.write'], actor: { kind: 'agent', id: deps.getCurrentAgentId?.() }, authorize: deps.authorizeCapability ?? (() => true) };
    const result = await capabilities.call(operation, input, caller, { ...capabilities.describe(operation, caller), idempotencyKey: trimString(args.idempotencyKey) ?? randomUUID() });
    return (command === 'create_update' ? ProjectUpdateOutputSchema : command === 'delete_milestone' ? ProjectMilestoneDeleteOutputSchema : ProjectMilestoneOutputSchema).parse(result);
  }

  return { ok: false, error: `Unsupported project command: ${command}` };
}

async function handleAutomation(
  command: string,
  args: Record<string, unknown>,
  deps: XopcUseToolDeps,
  dryRun: boolean,
  capabilities: CapabilityDispatcher,
): Promise<unknown> {
  const automations = deps.getAutomationService?.();
  if (!automations) return { ok: false, error: 'Automation service is unavailable' };
  const invoke = async (operation: string, input: unknown) => {
    const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`,
      surface: 'agent', scopes: ['automations.write'], authorize: deps.authorizeCapability ?? (() => true) };
    try {
      return (operation === 'xopc.automations.delete' ? AutomationDeleteOutputSchema
        : operation === 'xopc.automations.cancel' ? AutomationCancelOutputSchema
        : operation === 'xopc.automations.read' ? AutomationReadOutputSchema
        : operation === 'xopc.automations.read_all' ? AutomationReadAllOutputSchema
        : operation === 'xopc.automations.run' || operation === 'xopc.automations.rerun' ? AutomationRunMutationOutputSchema : AutomationMutationOutputSchema).parse(await capabilities.call(operation, input, caller,
        { ...capabilities.describe(operation, caller), idempotencyKey: trimString(args.idempotencyKey) ?? randomUUID() }));
    } catch (error) {
      if (error instanceof CapabilityError) return { ok: false as const, error: error.message, code: error.code };
      throw error;
    }
  };

  if (command === 'cancel' || command === 'read' || command === 'read_all') {
    const input = command === 'read_all' ? AutomationReadAllInputSchema.parse({ projectId: trimString(args.projectId) })
      : CapabilityResourceInputSchema.parse({ id: trimString(args.runId) ?? trimString(args.id) });
    if (dryRun) return { ok: true, dryRun: true, action: command, input };
    return invoke(`xopc.automations.${command}`, input);
  }

  if (command === 'create') {
    const source = automationPayload(args, 'automation');
    const explicitProjectId = trimString(args.projectId) ?? trimString(source.projectId);
    const projectId = explicitProjectId ?? currentProjectId({}, deps);
    if (dryRun) {
      const projectError = automationProjectError(projectId, deps);
      if (projectError) return { ok: false, error: projectError };
    }
    const input = AutomationCreateCapabilityInputSchema.parse({
      ...pickDefined(source, [
        'id', 'name', 'description', 'enabled', 'trigger', 'action', 'safety', 'conversationMode',
        'notificationPolicy', 'completionWebhookUrl', 'reliability', 'state',
      ]),
      ...(projectId ? { projectId } : {}),
    });
    if (dryRun) return { ok: true, dryRun: true, action: 'create_automation', input, projectId };
    const result = await invoke('xopc.automations.create', input);
    return { ...result, ...(result.ok && projectId ? { projectId } : {}) };
  }

  if (command === 'update') {
    const id = trimString(args.automationId) ?? trimString(args.id);
    if (!id) return { ok: false, error: 'automationId is required' };
    const source = automationPayload(args, 'patch');
    const patch = AutomationUpdatePatchSchema.parse(pickDefined(source, [
      'name', 'description', 'projectId', 'enabled', 'trigger', 'action', 'safety', 'conversationMode',
      'notificationPolicy', 'completionWebhookUrl', 'reliability', 'state',
    ]));
    if (dryRun) {
      const projectError = automationProjectError(patch.projectId, deps);
      if (projectError) return { ok: false, error: projectError };
    }
    if (dryRun) return { ok: true, dryRun: true, action: 'update_automation', automationId: id, patch };
    if (args.idempotencyKey !== undefined && args.expectedRevision === undefined) {
      return { ok: false, error: 'Idempotent automation changes require expectedRevision from the original read' };
    }
    const expectedRevision = args.expectedRevision !== undefined ? args.expectedRevision : (await automations.get(id))?.updatedAtMs;
    if (expectedRevision === undefined) return { ok: false, error: `Automation not found: ${id}` };
    return invoke('xopc.automations.update', { id, patch, expectedRevision });
  }


  if (command === 'rerun') {
    const runId = trimString(args.runId) ?? trimString(args.id);
    if (!runId) return { ok: false, error: 'runId is required' };
    if (dryRun) return { ok: true, dryRun: true, action: 'rerun_automation', runId };
    return invoke('xopc.automations.rerun', { id: runId });
  }
  if (!['delete', 'run', 'pause', 'resume'].includes(command)) {
    return { ok: false, error: `Unsupported automation command: ${command}` };
  }

  const id = trimString(args.automationId) ?? trimString(args.id);
  if (!id) return { ok: false, error: 'automationId is required' };
  if (!dryRun && command === 'run') return invoke('xopc.automations.run', { id });
  if (!dryRun && command === 'delete') {
    if (args.idempotencyKey !== undefined && args.expectedRevision === undefined) {
      return { ok: false, error: 'Idempotent deletion requires the original expectedRevision' };
    }
    const expectedRevision = args.expectedRevision !== undefined ? args.expectedRevision : (await automations.get(id))?.updatedAtMs ?? null;
    return invoke('xopc.automations.delete', { id, expectedRevision });
  }
  if (!dryRun && (command === 'pause' || command === 'resume')) {
    if (args.idempotencyKey !== undefined && args.expectedRevision === undefined) {
      return { ok: false, error: 'Idempotent automation changes require expectedRevision from the original read' };
    }
    const expectedRevision = args.expectedRevision !== undefined ? args.expectedRevision : (await automations.get(id))?.updatedAtMs;
    if (expectedRevision === undefined) return { ok: false, error: `Automation not found: ${id}` };
    return invoke('xopc.automations.set_enabled', { id, enabled: command === 'resume', expectedRevision });
  }
  const current = await automations.get(id);
  if (!current) return { ok: false, error: `Automation not found: ${id}` };
  if (dryRun) {
    return { ok: true, dryRun: true, action: `${command}_automation`, automationId: id, automation: current };
  }


  return { ok: false, error: `Automation command failed: ${command}` };
}

async function handleNote(
  command: string,
  args: Record<string, unknown>,
  deps: XopcUseToolDeps,
  dryRun: boolean,
  capabilities: CapabilityDispatcher,
): Promise<unknown> {
  const notes = deps.getNotesService?.();
  if (!notes) return { ok: false, error: 'Notes service is unavailable' };
  const invoke = async (operation: string, input: unknown) => {
    const context: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`,
      surface: 'agent', scopes: ['workspace.write'], authorize: deps.authorizeCapability ?? (() => true),
      actor: { kind: 'agent', id: deps.getCurrentAgentId?.() ?? 'main' } };
    return NoteGetOutputSchema.parse(await capabilities.call(operation, input, context,
      { ...capabilities.describe(operation, context), idempotencyKey: trimString(args.idempotencyKey) ?? randomUUID() }));
  };

  if (command === 'create') {
    const projectId = currentProjectId(args, deps);
    const projectService = projectId ? deps.getProjectService?.() : undefined;
    if (projectId && !projectService) return { ok: false, error: 'Project service is unavailable' };
    const project = projectId ? projectService?.get(projectId) : undefined;
    if (projectId && !project) return { ok: false, error: `Project not found: ${projectId}` };
    const markdown = typeof args.markdown === 'string' ? args.markdown : trimString(args.content) ?? '';
    const input = {
      title: trimString(args.title),
      markdown,
      kind: enumValue(args.kind, NOTE_KINDS),
      tags: stringArray(args.tags),
      capturedVia: { channel: 'web' as const },
      pinned: args.pinned === true,
    };
    if (dryRun) return { ok: true, dryRun: true, action: 'create_note', input, projectId };
    const { note } = await invoke('xopc.notes.create', { ...input, projectId });
    return { ok: true, note, ...(projectId ? { projectId } : {}) };
  }

  if (command === 'append') {
    const id = trimString(args.noteId) ?? trimString(args.id);
    const content = trimString(args.content);
    if (!id) return { ok: false, error: 'noteId is required' };
    if (!content) return { ok: false, error: 'content is required' };
    const heading = trimString(args.heading);
    if (dryRun) return { ok: true, dryRun: true, action: 'append_note', noteId: id, heading, content };
    const { note } = await invoke('xopc.notes.append', { id, content, heading, expectedRevision: args.expectedRevision });
    return { ok: true, note };
  }

  if (command === 'update') {
    const id = trimString(args.noteId) ?? trimString(args.id);
    if (!id) return { ok: false, error: 'noteId is required' };
    if (args.title !== undefined && typeof args.title !== 'string') return { ok: false, error: 'Invalid note title' };
    if (args.markdown !== undefined && typeof args.markdown !== 'string') return { ok: false, error: 'Invalid note markdown' };
    if (args.tags !== undefined && !Array.isArray(args.tags)) return { ok: false, error: 'Invalid note tags' };
    const title = args.title as string | undefined;
    const markdown = args.markdown as string | undefined;
    const patch = {
      ...(args.title !== undefined ? { title } : {}),
      ...(args.markdown !== undefined ? { markdown } : {}),
      ...(args.kind !== undefined ? { kind: enumValue(args.kind, NOTE_KINDS) } : {}),
      ...(args.status !== undefined ? { status: enumValue(args.status, NOTE_STATUSES) } : {}),
      ...(args.tags !== undefined ? { tags: stringArray(args.tags) ?? [] } : {}),
      ...(typeof args.pinned === 'boolean' ? { pinned: args.pinned } : {}),
    };
    if (args.kind !== undefined && patch.kind === undefined) return { ok: false, error: 'Invalid note kind' };
    if (args.status !== undefined && patch.status === undefined) return { ok: false, error: 'Invalid note status' };
    if (args.idempotencyKey !== undefined && args.expectedRevision === undefined) {
      return { ok: false, error: 'Idempotent note updates require expectedRevision from the original read' };
    }
    if (dryRun) return { ok: true, dryRun: true, action: 'update_note', noteId: id, patch };
    const current = await notes.getNote(id);
    if (!current) return { ok: false, error: `Note not found: ${id}` };
    const { note } = await invoke('xopc.notes.update', { id, patch, expectedRevision: args.expectedRevision ?? current.remoteVersion ?? 1 });
    return { ok: true, note };
  }

  if (command === 'delete') {
    const id = trimString(args.noteId) ?? trimString(args.id);
    if (!id) return { ok: false, error: 'noteId is required' };
    if (dryRun) {
      const note = await notes.getNote(id);
      return note
        ? { ok: true, dryRun: true, action: 'delete_note', noteId: id, note }
        : { ok: false, error: `Note not found: ${id}` };
    }
    if (args.idempotencyKey !== undefined && args.expectedRevision === undefined) return { ok: false, error: 'Stable retries require the original expectedRevision' };
    let expectedRevision = args.expectedRevision;
    if (expectedRevision === undefined) {
      const note = await notes.getNote(id);
      if (!note) return { ok: false, error: `Note not found: ${id}` };
      expectedRevision = note.remoteVersion ?? 1;
    }
    const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`, surface: 'agent',
      scopes: ['workspace.write'], authorize: deps.authorizeCapability ?? (() => true) };
    const operation = 'xopc.notes.delete';
    const result = NoteDeleteOutputSchema.parse(await capabilities.call(operation, { id, expectedRevision, revokeShares: args.revokeShares }, caller,
      { ...capabilities.describe(operation, caller), idempotencyKey: trimString(args.idempotencyKey) ?? randomUUID() }));
    return { ok: true, removed: result.deleted, noteId: id, revokedShares: result.revokedShares };
  }

  return { ok: false, error: `Unsupported note command: ${command}` };
}

async function handleTask(
  command: string,
  args: Record<string, unknown>,
  deps: XopcUseToolDeps,
  dryRun: boolean,
  capabilities: CapabilityDispatcher,
): Promise<unknown> {
  const tasks = new TaskRepository();
  const runs = new TaskRunRepository();
  const deletion = new TaskDeletionService(tasks, runs);
  const invokeRelation = (operation: string, input: unknown) => {
    const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`, surface: 'agent', scopes: ['tasks.write'],
      actor: { kind: 'agent', id: deps.getCurrentAgentId?.() ?? 'main' }, authorize: deps.authorizeCapability ?? (() => true) };
    return capabilities.call(operation, input, caller, { ...capabilities.describe(operation, caller),
      idempotencyKey: trimString(args.idempotencyKey) ?? randomUUID() });
  };

  if (command === 'delete') {
    const id = trimString(args.taskId) ?? trimString(args.id);
    if (!id) return { ok: false, error: 'taskId is required' };
    const result = dryRun ? deletion.inspect(id) : TaskDeleteOutputSchema.parse(await invokeRelation('xopc.tasks.delete', { taskId: id, expectedVersion: args.expectedVersion }));
    if (result.ok === true) {
      return dryRun
        ? { ok: true, dryRun: true, action: 'delete_task', taskId: id, task: result.task }
        : { ok: true, removed: true, taskId: id };
    }
    return result.reason === 'active_run'
      ? { ok: false, error: 'Cancel the active TaskRun before deleting the Task', runId: result.run.id }
      : { ok: false, error: `Task not found: ${id}` };
  }

  if (command === 'create') {
    const objective = trimString(args.objective) ?? trimString(args.title);
    if (!objective) return { ok: false, error: 'objective is required' };
    const createMode = args.createMode === undefined
      ? 'capture'
      : enumValue(args.createMode, TASK_CREATE_MODES);
    if (!createMode) return { ok: false, error: 'Invalid createMode' };
    if (createMode === 'start' && !deps.dispatchTaskRuns) {
      return { ok: false, error: 'Task execution service is unavailable' };
    }
    const projectId = currentProjectId(args, deps);
    if (projectId) {
      const projects = deps.getProjectService?.();
      if (!projects) return { ok: false, error: 'Project service is unavailable' };
      if (!projects.get(projectId)) return { ok: false, error: `Project not found: ${projectId}` };
    }
    const priority = args.priority === undefined
      ? undefined
      : enumValue(args.priority, TASK_PRIORITIES);
    if (args.priority !== undefined && !priority) return { ok: false, error: 'Invalid task priority' };
    const dueAt = args.dueAt === undefined ? undefined : finiteNumber(args.dueAt);
    if (args.dueAt !== undefined && (dueAt === undefined || dueAt < 0)) {
      return { ok: false, error: 'Invalid dueAt' };
    }
    const locale = args.locale === undefined
      ? undefined
      : enumValue(args.locale, new Set(['en', 'zh'] as const));
    if (args.locale !== undefined && !locale) return { ok: false, error: 'Invalid locale' };
    const dependsOnTaskIds = args.dependsOnTaskIds === undefined
      ? []
      : stringArray(args.dependsOnTaskIds);
    if (!dependsOnTaskIds) return { ok: false, error: 'Invalid dependsOnTaskIds' };
    const baseContract = defineTaskContract(objective);
    const contractFields = [
      'expectedOutputs',
      'acceptanceCriteria',
      'constraints',
      'approvalRequired',
      'assumptions',
      'risks',
    ] as const;
    const contract = { ...baseContract };
    for (const field of contractFields) {
      if (args[field] === undefined) continue;
      const value = stringArray(args[field]);
      if (!value) return { ok: false, error: `Invalid ${field}` };
      contract[field] = value;
    }
    const conversationId = trimString(args.conversationId) ?? deps.getCurrentConversationId?.();
    const config = deps.getConfig?.();
    const projectService = deps.getProjectService?.();
    const explicitAgentId = trimString(args.agentId);
    const agentId = config && projectService
      ? resolveProjectAgentId({ config, projects: projectService, explicitAgentId, projectId })
      : explicitAgentId ?? (config ? getDefaultAgentId(config) : deps.getCurrentAgentId?.() ?? 'main');
    const input = {
      idempotencyKey: trimString(args.idempotencyKey) ?? randomUUID(),
      title: trimString(args.title) ?? objective,
      priority: priority ?? 'normal' as const,
      ...(dueAt === undefined ? {} : { dueAt }),
      ...(projectId ? { projectId } : {}),
      delegateAgentId: agentId,
      ...(locale ? { locale } : {}),
      contract: {
        ...contract,
        acceptancePolicy: 'verified_auto' as const,
        outputDestinations: [],
      },
      dependencies: dependsOnTaskIds,
      context: conversationId ? [{
        targetKind: 'session' as const,
        targetId: conversationId,
        role: 'input' as const,
        pinned: false,
        retrievalPolicy: {},
        metadata: {},
      }] : [],
      authorityGrants: [],
      activation: createMode === 'capture'
        ? { mode: 'capture' as const, phase: 'backlog' as const }
        : { mode: 'start' as const, executor: { kind: 'agent' as const, agentId } },
    };
    if (dryRun) {
      return { ok: true, dryRun: true, action: 'create_task', createMode, input, dependsOnTaskIds };
    }
    const capabilityContext: CapabilityContext = {
      principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`, surface: 'agent', scopes: ['tasks.write'],
      actor: { kind: 'agent', id: deps.getCurrentAgentId?.() ?? 'main' },
      authorize: deps.authorizeCapability ?? (() => true),
    };
    const { idempotencyKey, ...capabilityInput } = input;
    const created = TaskMutationOutputSchema.parse(await capabilities.call('xopc.tasks.create', capabilityInput, capabilityContext,
      { ...capabilities.describe('xopc.tasks.create', capabilityContext), idempotencyKey }));
    if (created.ok === false) return { ok: false, error: created.reason, ...created };
    return { ok: true, task: created.model.task, operationalState: created.model.operationalState,
      createMode, ...(created.runId ? { runId: created.runId } : {}) };
  }

  if (command === 'update_dependencies') {
    const id = trimString(args.taskId) ?? trimString(args.id);
    const expectedVersion = finiteNumber(args.expectedVersion);
    const dependsOnTaskIds = stringArray(args.dependsOnTaskIds);
    if (!id) return { ok: false, error: 'taskId is required' };
    if (expectedVersion === undefined || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return { ok: false, error: 'expectedVersion is required' };
    }
    if (!dependsOnTaskIds) return { ok: false, error: 'dependsOnTaskIds is required' };
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        action: 'update_task_dependencies',
        taskId: id,
        expectedVersion,
        dependsOnTaskIds,
      };
    }
    return invokeRelation('xopc.tasks.update_dependencies', { taskId: id, dependsOnTaskIds, expectedVersion });
  }

  if (command === 'add_context') {
    const id = trimString(args.taskId) ?? trimString(args.id);
    if (!id) return { ok: false, error: 'taskId is required' };
    if (!tasks.get(id)) return { ok: false, error: `Task not found: ${id}` };
    const parsed = TaskContextInputSchema.safeParse({
      targetKind: args.targetKind,
      targetId: args.targetId,
      role: args.role,
      title: args.title,
      pinned: args.pinned === true,
      retrievalPolicy: record(args.retrievalPolicy) ?? {},
      metadata: record(args.metadata) ?? {},
    });
    if (!parsed.success) return { ok: false, error: 'Invalid task context edge' };
    const input = {
      taskId: id,
      ...parsed.data,
      createdBy: { kind: 'agent' as const, id: deps.getCurrentAgentId?.() },
    };
    if (dryRun) return { ok: true, dryRun: true, action: 'add_task_context', input };
    return invokeRelation('xopc.tasks.add_context', { taskId: id, edge: parsed.data, expectedVersion: args.expectedVersion });
  }

  if (command === 'remove_context') {
    const id = trimString(args.taskId) ?? trimString(args.id);
    const edgeId = trimString(args.edgeId);
    if (!id) return { ok: false, error: 'taskId is required' };
    if (!edgeId) return { ok: false, error: 'edgeId is required' };
    if (dryRun) return { ok: true, dryRun: true, action: 'remove_task_context', taskId: id, edgeId };
    return invokeRelation('xopc.tasks.remove_context', { taskId: id, edgeId, expectedVersion: args.expectedVersion });
  }

  if (command === 'command') {
    const id = trimString(args.taskId) ?? trimString(args.id);
    const commandType = enumValue(args.type, TASK_COMMANDS);
    const expectedVersion = finiteNumber(args.expectedVersion);
    if (!id) return { ok: false, error: 'taskId is required' };
    if (!commandType) return { ok: false, error: 'Invalid task command type' };
    if (expectedVersion === undefined || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return { ok: false, error: 'expectedVersion is required' };
    }
    if (commandType === 'start' && !deps.dispatchTaskRuns) {
      return { ok: false, error: 'Task execution service is unavailable' };
    }
    const commandArgs = args.commandArgs && typeof args.commandArgs === 'object'
      ? args.commandArgs as Record<string, unknown>
      : {};
    const parsedCommand = TaskCommandSchema.safeParse({ type: commandType, ...commandArgs });
    if (!parsedCommand.success) return { ok: false, error: 'Invalid task command payload' };
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        action: 'execute_task_command',
        taskId: id,
        command: parsedCommand.data,
        expectedVersion,
      };
    }
    const capabilityContext: CapabilityContext = {
      principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`, surface: 'agent', scopes: ['tasks.write'],
      actor: { kind: 'agent', id: deps.getCurrentAgentId?.() ?? 'main' },
      authorize: deps.authorizeCapability ?? (() => true),
    };
    const result = TaskMutationOutputSchema.parse(await capabilities.call('xopc.tasks.command',
      { taskId: id, expectedVersion, command: parsedCommand.data }, capabilityContext,
      { ...capabilities.describe('xopc.tasks.command', capabilityContext), idempotencyKey: trimString(args.idempotencyKey) ?? randomUUID() }));
    if (result.ok === false) {
      return {
        ok: false,
        error: result.reason,
        command: parsedCommand.data,
        ...result,
      };
    }
    return {
      ok: true,
      task: result.model.task,
      operationalState: result.model.operationalState,
      command: parsedCommand.data,
      ...(result.runId ? { runId: result.runId } : {}),
    };
  }

  return { ok: false, error: `Unsupported task command: ${command}` };
}

async function handleTaskRun(
  command: string,
  args: Record<string, unknown>,
  dryRun: boolean,
  deps: XopcUseToolDeps,
  capabilities: CapabilityDispatcher,
): Promise<unknown> {
  if (command === 'feedback') {
    const input = TaskRunFeedbackInputSchema.parse({ id: args.runId ?? args.id, rating: args.rating, reason: args.reason });
    if (dryRun) return { ok: true, dryRun: true, action: 'task_run_feedback', input };
    const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`, surface: 'agent',
      scopes: ['tasks.write'], actor: { kind: 'agent', id: deps.getCurrentAgentId?.() }, authorize: deps.authorizeCapability ?? (() => true) };
    const operation = 'xopc.task_runs.feedback';
    return TaskRunFeedbackOutputSchema.parse(await capabilities.call(operation, input, caller,
      { ...capabilities.describe(operation, caller), idempotencyKey: trimString(args.idempotencyKey) ?? randomUUID() }));
  }
  if (command === 'cancel') {
    const input = TaskRunCancelInputSchema.parse({ id: args.runId ?? args.id, expectedVersion: args.expectedVersion, reason: args.reason });
    if (dryRun) {
      const run = new TaskRunRepository().get(input.id);
      if (!run) return { ok: false, error: 'TaskRun not found' };
      if (run.version !== input.expectedVersion) return { ok: false, error: 'TaskRun changed', reason: 'conflict', run };
      return { ok: true, dryRun: true, action: 'cancel_task_run', runId: input.id, expectedVersion: input.expectedVersion, reason: input.reason };
    }
    const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`, surface: 'agent',
      scopes: ['tasks.write'], actor: { kind: 'agent', id: deps.getCurrentAgentId?.() }, authorize: deps.authorizeCapability ?? (() => true) };
    const operation = 'xopc.task_runs.cancel';
    return TaskRunCancelOutputSchema.parse(await capabilities.call(operation, input, caller,
      { ...capabilities.describe(operation, caller), idempotencyKey: trimString(args.idempotencyKey) ?? randomUUID() }));
  }

  return { ok: false, error: `Unsupported task_run command: ${command}` };
}

async function handleLocalApp(
  command: string,
  args: Record<string, unknown>,
  deps: XopcUseToolDeps,
  dryRun: boolean,
): Promise<unknown> {
  const localApps = deps.getLocalAppService?.();
  if (!localApps) return { ok: false, error: 'Local app service is unavailable' };

  if (command === 'create') {
    const name = trimString(args.name);
    const idea = trimString(args.idea);
    if (!name) return { ok: false, error: 'name is required' };
    if (!idea) return { ok: false, error: 'idea is required' };
    const input = { name, idea, description: trimString(args.description) };
    if (dryRun) return { ok: true, dryRun: true, action: 'create_local_app', input };
    return { ok: true, app: localApps.create(input) };
  }

  return { ok: false, error: `Unsupported local_app command: ${command}` };
}

async function handleChatPreview(
  command: string,
  args: Record<string, unknown>,
  deps: XopcUseToolDeps,
  dryRun: boolean,
): Promise<unknown> {
  const previews = deps.getChatPreviewService?.();
  if (!previews) return { ok: false, error: 'Chat preview service is unavailable' };
  const id = trimString(args.previewId) ?? trimString(args.id);

  if (command === 'create') {
    const conversationId = deps.getCurrentConversationId?.();
    if (!conversationId) return { ok: false, error: 'A current conversation is required' };
    const input = ChatPreviewCreateInputSchema.parse(args);
    if (dryRun) return { ok: true, dryRun: true, action: 'create_chat_preview', input };
    return { ok: true, ...previews.create(conversationId, input) };
  }

  if (!id) return { ok: false, error: 'previewId is required' };
  if (command === 'get') {
    const preview = previews.get(id);
    const revision = previews.getRevision(id, trimString(args.sourceHash) ?? preview.latestRevision);
    return { ok: true, preview, revision };
  }
  if (command === 'revise') {
    const { previewId: _previewId, id: _id, ...rawInput } = args;
    const input = ChatPreviewReviseInputSchema.parse(rawInput);
    if (dryRun) return { ok: true, dryRun: true, action: 'revise_chat_preview', previewId: id, input };
    return { ok: true, ...previews.revise(id, input) };
  }
  return { ok: false, error: `Unsupported chat_preview command: ${command}` };
}

export function createXopcUseTool(deps: XopcUseToolDeps): AgentTool<typeof XopcUseToolSchema, XopcUseDetails> {
  const capabilities = createProductDispatcher(deps.getNotesService, {
    getConfig: deps.getConfig, getProjects: deps.getProjectService,
    getWorkDiscovery: deps.getWorkDiscovery,
    getLocalApps: deps.getLocalAppService,
    getSceneAccess: deps.getSceneAccess,
    getAutomations: deps.getAutomationService,
    wake: deps.dispatchTaskRuns || deps.dispatchTaskEvents ? runId => runId ? deps.dispatchTaskRuns?.() : deps.dispatchTaskEvents?.() : undefined,
  });
  return {
    name: 'xopc_use',
    label: 'XOPC Use',
    description:
      'Operate first-class xopc objects through one safe entry point. Use chat_preview for lightweight UI mockups in the current conversation; do not create a Local App unless the user asks for a durable app. Local App capabilities takes extensionId and discovers already granted bindings. Local App invoke requires extensionId, the discovered manifestDigest, capabilityId and a pinned call {majorVersion, descriptorDigest, input, idempotencyKey for writes}. Never manufacture grants or change a retry key after an uncertain write. Use for scenes, projects, automations, notes, tasks, TaskRuns, chat previews, local apps, and exact settings jump targets instead of editing storage files directly. For non-trivial object changes, load the built-in manual first with tool_manual({ tool: "xopc_use" }).',
    parameters: XopcUseToolSchema,
    mutatesWorkspace: true,
    mutationScope: 'external',
    requiresExclusiveWorkspaceLock: true,
    finalGuardRelevant: true,
    async execute(toolCallId, input: XopcUseToolInput, signal): Promise<AgentToolResult<XopcUseDetails>> {
      const mode = input.mode;
      const command = input.command.trim();
      const dryRun = input.dryRun === true;
      const args = ensureArgs(input);
      const details: XopcUseDetails = { mode, command, dryRun };
      if (!command) return errorText('command is required', details);
      if (mode === 'local_app' && (command === 'capabilities' || command === 'invoke')) {
        const apps = deps.getLocalAppService?.();
        if (!apps) return errorText('Local app service is unavailable', details);
        if (typeof args.extensionId !== 'string') return errorText('extensionId is required', details);
        const manifestDigest = command === 'capabilities' ? apps.getUiGrant(args.extensionId).manifestDigest : args.manifestDigest;
        if (typeof manifestDigest !== 'string') return errorText('A discovered manifestDigest is required', details);
        const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`,
          surface: 'agent', scopes: ['gateway.admin'], authorize: deps.authorizeCapability ?? (() => true), signal };
        const runtime = localAppCapabilities(apps, capabilities, args.extensionId, manifestDigest, caller);
        if (command === 'capabilities') return okText({ ...details, result: runtime.list() });
        if (dryRun) return errorText('Use capabilities to inspect the pinned contract; invoke does not execute in dryRun', details);
        if (typeof args.capabilityId !== 'string') return errorText('capabilityId is required', details);
        const call = CapabilityCallSchema.parse(args.call);
        return okText({ ...details, result: await runtime.call(args.capabilityId, call) });
      }
      if (mode === 'context' && command === 'resolve') {
        const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`,
          surface: 'agent', scopes: ['gateway.admin'], authorize: deps.authorizeCapability ?? (() => true), signal };
        return okText({ ...details, result: await capabilities.call('xopc.context.resolve', args, caller) });
      }
      if (mode === 'scene' && (['configure', 'check', 'notes', 'work_item', 'update_work_item', 'schedule', 'set_preferences', 'feedback', 'mark_read', 'transition'].includes(command) || (command === 'start' && !dryRun))) {
        const operation = `xopc.scenes.${command}` as keyof typeof SceneWriteContracts;
        const { requestId, idempotencyKey, workItemId, presentationId, ...fields } = args;
        if ((requestId !== undefined && typeof requestId !== 'string') || (idempotencyKey !== undefined && typeof idempotencyKey !== 'string')) {
          return errorText('Request identity must be a string', details);
        }
        const projectedInput = command === 'update_work_item' ? { ...fields, id: workItemId ?? fields.id }
          : command === 'feedback' || command === 'mark_read' ? { ...fields, id: presentationId ?? fields.id } : fields;
        const parsed = SceneWriteContracts[operation].input.safeParse(projectedInput);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          const field = issue?.path.join('.') || 'input';
          const expected = issue?.code === 'invalid_type' ? issue.expected : undefined;
          return errorText(expected ? `${field} must be ${/^[aeiou]/.test(expected) ? 'an' : 'a'} ${expected}` : issue?.message ?? 'Invalid input', details);
        }
        if (dryRun) return okText({ ...details, result: { preview: true, command, input: parsed.data } });
        const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`,
          surface: 'agent', scopes: ['gateway.admin'], authorize: deps.authorizeCapability ?? (() => true), signal };
        try {
          const result = await capabilities.call(operation, parsed.data, caller, { ...capabilities.describe(operation, caller),
            idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : typeof requestId === 'string' ? requestId : toolCallId });
          return okText({ ...details, result, delivery: deliveryForXopcResult(mode, command, result, dryRun) });
        } catch (error) {
          if (error instanceof CapabilityError) return errorText(error.message, details);
          throw error;
        }
      }
      if (mode === 'scene' && (['templates', 'get_template', 'list', 'get', 'read_notes', 'list_runs', 'list_schedules', 'list_work_items', 'get_preferences', 'preflight',
        'mail_accounts', 'mail_sources', 'results', 'get_presentation', 'get_feedback', 'digest_results', 'metrics', 'diagnostics'].includes(command) || (command === 'start' && dryRun))) {
        const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`,
          surface: 'agent', scopes: ['gateway.admin'], authorize: deps.authorizeCapability ?? (() => true), signal };
        const { id: _id, requestId: _requestId, triggerKey: _triggerKey, ...preflightInput } = args;
        const result = await capabilities.call(`xopc.scenes.${command === 'start' ? 'preflight' : command}`,
          command === 'start' || command === 'preflight' ? preflightInput
            : command === 'results' ? { ...preflightInput, activationId: args.activationId ?? args.id } : args, caller);
        return okText({ ...details, result, delivery: deliveryForXopcResult(mode, command, result, dryRun) });
      }
      if (mode === 'settings' && command === 'open') {
        const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`,
          surface: 'agent', scopes: ['gateway.status'], authorize: deps.authorizeCapability ?? (() => true), signal };
        const result = await capabilities.call('xopc.settings.open', args, caller);
        return okText({ ...details, result, delivery: deliveryForXopcResult(mode, command, result, dryRun) });
      }
      if (mode === 'local_app' && (command === 'get' || command === 'list' || command === 'validate')) {
        const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`,
          surface: 'agent', scopes: ['gateway.admin'], authorize: deps.authorizeCapability ?? (() => true), signal };
        const id = args.localAppId ?? args.id;
        const result = await capabilities.call(`xopc.local_apps.${command}`, command === 'list' ? {} : { id }, caller) as Record<string, unknown>;
        if (command === 'validate') Object.assign(result, await capabilities.call('xopc.local_apps.get', { id }, caller));
        const appId = deliveryText(record(result.app)?.id);
        const snapshot = appId && command !== 'list'
          ? deps.getLocalAppService?.()?.materializeSnapshot(appId)
          : undefined;
        const deliveryResult = snapshot ? { ...result, snapshot } : result;
        return okText({ ...details, result: { ok: true, ...result }, delivery: deliveryForXopcResult(mode, command, deliveryResult, dryRun) });
      }
      if (mode === 'task' && command === 'metrics') {
        const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`,
          surface: 'agent', scopes: ['tasks.read'], authorize: deps.authorizeCapability ?? (() => true), signal };
        return okText({ ...details, result: await capabilities.call('xopc.tasks.metrics', {}, caller) });
      }
      if (mode === 'local_app' && command === 'record_acceptance') {
        const { idempotencyKey, localAppId, ...input } = args;
        if (idempotencyKey !== undefined && typeof idempotencyKey !== 'string') return errorText('idempotencyKey must be a string', details);
        const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`,
          surface: 'agent', scopes: ['gateway.admin'], authorize: deps.authorizeCapability ?? (() => true), signal };
        if (dryRun) return okText({ ...details, result: { ok: true, dryRun: true, input } });
        const operation = 'xopc.local_apps.record_acceptance';
        return okText({ ...details, result: await capabilities.call(operation, { ...input, id: localAppId ?? input.id }, caller, {
          ...capabilities.describe(operation, caller), idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : toolCallId,
        }) });
      }
      if (mode === 'note' && ['project_summaries', 'history', 'snapshot', 'preview_edit'].includes(command)) {
        const projectedInput = command === 'project_summaries' ? {} : {
          id: args.noteId ?? args.id, ...(command === 'snapshot' ? { timestamp: args.timestamp } : {}),
          ...(command === 'preview_edit' ? { instruction: args.instruction, markdown: args.markdown } : {}),
        };
        const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`,
          surface: 'agent', scopes: ['workspace.read'], authorize: deps.authorizeCapability ?? (() => true), signal };
        const result = await capabilities.call(`xopc.notes.${command}`, projectedInput, caller) as Record<string, unknown>;
        return okText({ ...details, result: command === 'preview_edit' ? { ok: true, ...result } : result,
          delivery: deliveryForXopcResult(mode, command, result, dryRun) });
      }
      if (mode === 'automation' && ['get_run', 'run_events', 'metrics', 'product_events'].includes(command)) {
        const projectedInput = command === 'metrics' ? {} : command === 'product_events'
          ? { eventType: args.eventType, source: args.source, payloadKey: args.payloadKey, payloadValue: args.payloadValue, limit: args.limit }
          : { id: args.runId ?? args.id };
        const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`,
          surface: 'agent', scopes: ['automations.read'], authorize: deps.authorizeCapability ?? (() => true), signal };
        const result = await capabilities.call(`xopc.automations.${command}`, projectedInput, caller);
        return okText({ ...details, result });
      }
      if (mode === 'automation' && ['draft', 'repair_draft', 'simulate'].includes(command)) {
        const operation = `xopc.automations.${command}`;
        const { idempotencyKey, ...input } = args;
        if (idempotencyKey !== undefined && typeof idempotencyKey !== 'string') return errorText('idempotencyKey must be a string', details);
        const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`,
          surface: 'agent', scopes: [command === 'simulate' ? 'automations.read' : 'automations.write'],
          authorize: deps.authorizeCapability ?? (() => true), signal };
        if (dryRun && command !== 'simulate') return okText({ ...details, result: { ok: true, dryRun: true, input } });
        return okText({ ...details, result: await capabilities.call(operation, input, caller, {
          ...capabilities.describe(operation, caller), idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : toolCallId,
        }) });
      }
      if (mode === 'automation' && ['get', 'list', 'history'].includes(command)) {
        const id = trimString(args.automationId) ?? trimString(args.id);
        const projectId = command === 'get' || (command === 'history' && id) ? undefined : currentProjectId(args, deps);
        const projectedInput = command === 'get' ? { id } : command === 'list' ? { projectId }
          : { automationId: id, projectId, limit: args.limit ?? 20 };
        const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`,
          surface: 'agent', scopes: ['automations.read'], authorize: deps.authorizeCapability ?? (() => true), signal };
        const result = await capabilities.call(`xopc.automations.${command}`, projectedInput, caller);
        return okText({ ...details, result, delivery: deliveryForXopcResult(mode, command, result, dryRun) });
      }

      if (mode === 'project' && ['get', 'list', 'list_milestones', 'list_updates'].includes(command)) {
        const id = args.projectId ?? args.id;
        const projectedInput = command === 'list'
          ? Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'conversationId'))
          : { id, ...(command === 'list_updates' && args.limit !== undefined ? { limit: args.limit } : {}) };
        const context: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`,
          surface: 'agent', scopes: ['workspace.read'], authorize: deps.authorizeCapability ?? (() => true), signal };
        const result = await capabilities.call(`xopc.projects.${command}`, projectedInput, context);
        return okText({ ...details, result, delivery: deliveryForXopcResult(mode, command, result, dryRun) });
      }

      if ((mode === 'note' || mode === 'task' || mode === 'task_run') && (command === 'get' || command === 'list')) {
        const id = mode === 'note' ? args.noteId ?? args.id : mode === 'task_run' ? args.runId ?? args.id : args.taskId ?? args.id;
        const projectId = mode === 'task_run' ? undefined : currentProjectId(args, deps);
        const capabilityId = `xopc.${mode === 'note' ? 'notes' : mode === 'task_run' ? 'task_runs' : 'tasks'}.${command}`;
        const context: CapabilityContext = {
          principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`,
          surface: 'agent', scopes: ['workspace.read', 'tasks.read'],
          allowedCapabilities: ['xopc.notes.get', 'xopc.notes.list', 'xopc.tasks.get', 'xopc.tasks.list', 'xopc.task_runs.get', 'xopc.task_runs.list'],
          authorize: deps.authorizeCapability ?? (() => true),
          signal,
        };
        const input = command === 'get' ? { id } : {
          ...Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'conversationId')),
          ...(projectId ? { projectId } : {}), limit: args.limit ?? 20,
        };
        const result = await capabilities.call(capabilityId, input, context) as Record<string, unknown>;
        const projected = mode === 'task' && command === 'list'
          ? { ...result, items: (result.items as Array<{ task: unknown }>).map(item => item.task) }
          : mode === 'task' && command === 'get'
            ? { ...result, model: { task: result.task, operationalState: result.operationalState,
              attention: result.attention, allowedCommands: result.allowedCommands } }
            : result;
        return okText({ ...details, result: { ok: true, ...projected, ...(command === 'list' && projectId ? { projectId } : {}) },
          delivery: deliveryForXopcResult(mode, command, projected, dryRun) });
      }

      try {
        const conversationId = deps.getCurrentConversationId?.();
        const agentId = deps.getCurrentAgentId?.();
        const result = await runWithActivityContext(
          {
            actor: { kind: 'agent', agentId, conversationId },
            initiator: { kind: 'user', conversationId },
            source: { kind: 'xopc_use', toolCallId },
          },
          async () =>
            mode === 'scene'
              ? await handleScene(command, args, deps, dryRun)
              : mode === 'project'
            ? await handleProject(command, args, deps, dryRun, capabilities)
              : mode === 'automation'
                ? await handleAutomation(command, args, deps, dryRun, capabilities)
                : mode === 'note'
                  ? await handleNote(command, args, deps, dryRun, capabilities)
                : mode === 'task'
                  ? await handleTask(command, args, deps, dryRun, capabilities)
                  : mode === 'task_run'
                    ? await handleTaskRun(command, args, dryRun, deps, capabilities)
                  : mode === 'local_app'
                    ? await handleLocalApp(command, args, deps, dryRun)
                  : mode === 'chat_preview'
                    ? await handleChatPreview(command, args, deps, dryRun)
                      : { ok: false, error: `Unsupported mode: ${String(mode)}` },
        );
        const resultRecord = record(result);
        const createdApp = mode === 'local_app' && command === 'create' ? record(resultRecord.app) : undefined;
        const createdAppId = deliveryText(createdApp?.id);
        const deliveryResult = createdAppId
          ? { ...resultRecord, snapshot: deps.getLocalAppService?.()?.materializeSnapshot(createdAppId) }
          : result;
        return okText({
          ...details,
          result,
          delivery: deliveryForXopcResult(mode, command, deliveryResult, dryRun),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorText(message, details);
      }
    },
  } as AgentTool<typeof XopcUseToolSchema, XopcUseDetails>;
}

async function handleScene(command: string, args: Record<string, unknown>, deps: XopcUseToolDeps, dryRun: boolean) {
  if (command !== 'mail_search') throw new Error('Unsupported scene command');
  const access = deps.getSceneAccess?.();
  if (!access) throw new Error('Scene service is unavailable');
  const { services, principal } = access;
  if (!services.mailDiscovery) throw new Error('Mail search is unavailable');
  if (dryRun) return { preview: true, command, input: args };
  return { sources: await services.mailDiscovery.searchSources(principal, args, AbortSignal.timeout(15000)) };
}
