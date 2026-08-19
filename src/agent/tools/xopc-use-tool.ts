import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  appendProductDeliveryText,
  type TaskAction,
  type TaskPriority,
  type TaskStatus,
  type ProductDeliveryEnvelope,
  type ProductReference,
} from '@xopcai/gateway-contract';

import { ObjectLinkService, runWithActivityContext } from '../../activity/index.js';
import type { Config } from '../../config/schema.js';
import type { NoteKind, NotesService, NoteStatus } from '../../notes/index.js';
import {
  isValidProjectAgentId,
  normalizeProjectAgentId,
  type ProjectService,
  type ProjectStatus,
} from '../../projects/index.js';
import type { LocalAppService } from '../../local-apps/index.js';
import { getSessionMetadata } from '../../storage/sqlite/index.js';
import {
  defineTaskContract,
  TaskCommandService,
  TaskRepository,
  type EnqueueTaskOptions,
  type TaskQueueItem,
} from '../../tasks/index.js';
import {
  TaskDependencyError,
  TaskDependencyService,
} from '../../tasks/task-dependency-service.js';

const XopcUseToolSchema = Type.Object({
  mode: Type.Union([
    Type.Literal('project'),
    Type.Literal('note'),
    Type.Literal('task'),
    Type.Literal('local_app'),
    Type.Literal('settings'),
  ]),
  command: Type.String({
    description:
      'Object command. Supports project list/get/create/update/resolve_workspace, note list/get/create/append/update/preview_edit, task list/get/create/update_dependencies/action, local_app list/get/create/validate, and settings open.',
  }),
  args: Type.Optional(Type.Record(Type.String(), Type.Any())),
  dryRun: Type.Optional(Type.Boolean({
    description: 'Validate and preview the action without mutating xopc state.',
  })),
});

export type XopcUseMode = 'project' | 'note' | 'task' | 'local_app' | 'settings';

export interface XopcUseToolInput {
  mode: XopcUseMode;
  command: string;
  args?: Record<string, unknown>;
  dryRun?: boolean;
}

export interface XopcUseToolDeps {
  getConfig?: () => Config | undefined;
  getCurrentAgentId?: () => string | undefined;
  getCurrentSessionKey?: () => string | undefined;
  getNotesService?: () => NotesService | undefined;
  getProjectService?: () => ProjectService | undefined;
  getLocalAppService?: () => LocalAppService | undefined;
  enqueueTask?: (taskId: string, options?: EnqueueTaskOptions) => TaskQueueItem;
}

type XopcUseDetails = {
  mode: XopcUseMode;
  command: string;
  dryRun: boolean;
  result?: unknown;
  delivery?: ProductDeliveryEnvelope;
};

const PROJECT_STATUSES = new Set<ProjectStatus>(['active', 'paused', 'archived']);
const NOTE_KINDS = new Set<NoteKind>(['thought', 'todo', 'voice', 'media', 'bookmark', 'mixed', 'task']);
const NOTE_STATUSES = new Set<NoteStatus>(['inbox', 'processed', 'archived', 'trashed']);
const TASK_STATUSES = new Set<TaskStatus>([
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
const TASK_PRIORITIES = new Set<TaskPriority>(['low', 'normal', 'high', 'critical']);
const TASK_ACTIONS = new Set<TaskAction>(['run', 'pause', 'resume', 'verify', 'cancel']);
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

function boundedLimit(value: unknown, fallback = 20, max = 100): number {
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : fallback;
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(raw)));
}

function offset(value: unknown): number | undefined {
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : undefined;
  return raw !== undefined && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : undefined;
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
  if (dryRun || command === 'list') return undefined;
  const resultRecord = record(result);
  if (!resultRecord || resultRecord.ok === false) return undefined;

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
        revision: deliveryRevision(source?.updatedAt),
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
        revision: deliveryRevision(source?.localVersion) ?? deliveryRevision(source?.updatedAt),
        projectId: deliveryText(resultRecord.projectId),
        capabilities: ['open', 'preview', 'edit', 'continue_in_chat', 'share'],
      };
    }
  } else if (mode === 'task') {
    source = record(resultRecord.task);
    const id = deliveryText(source?.id);
    if (id) {
      const status = deliveryText(source?.status);
      const statusCapability: ProductReference['capabilities'][number] | undefined = status === 'pending'
        ? 'run'
        : status === 'planning' || status === 'running' || status === 'verifying'
          ? 'pause'
          : status === 'paused' || status === 'needs_user' || status === 'blocked'
            ? 'resume'
            : undefined;
      primary = {
        kind: 'task',
        id,
        title: deliveryText(source?.objective) ?? 'Task',
        status,
        revision: deliveryRevision(source?.updatedAt),
        projectId: deliveryText(record(source?.execution)?.projectId),
        capabilities: ['open', 'continue_in_chat', ...(statusCapability ? [statusCapability] : [])],
      };
    }
  } else if (mode === 'local_app') {
    source = record(resultRecord.app);
    const id = deliveryText(source?.id);
    if (id) {
      primary = {
        kind: 'local_app',
        id,
        title: deliveryText(source?.name) ?? 'Local app',
        summary: deliverySummary(source?.description, source?.idea),
        status: deliveryText(source?.installationState) ?? deliveryText(source?.status),
        revision: deliveryRevision(source?.updatedAt),
        projectId: deliveryText(source?.projectId),
        capabilities: ['open', 'preview', 'edit', 'continue_in_chat', 'run'],
      };
    }
  } else {
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
  return {
    version: 1,
    operation: command === 'action' && ['run', 'resume'].includes(deliveryText(resultRecord.action) ?? '')
      ? 'started'
      : command === 'create'
      ? 'created'
      : command === 'get' || command === 'resolve_workspace' || mode === 'settings'
        ? 'opened'
        : command === 'validate'
          ? 'completed'
        : 'updated',
    primary,
  };
}

function currentProjectId(args: Record<string, unknown>, deps: XopcUseToolDeps): string | undefined {
  const explicit = trimString(args.projectId);
  if (explicit) return explicit;
  const sessionKey = trimString(args.sessionKey) ?? deps.getCurrentSessionKey?.();
  return sessionKey ? getSessionMetadata(sessionKey)?.projectId : undefined;
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

function validateDefaultAgentId(raw: unknown, config: Config | undefined): string | null | undefined {
  if (raw === null) return null;
  const normalized = normalizeProjectAgentId(trimString(raw));
  if (!normalized) return undefined;
  if (config && !isValidProjectAgentId(config, normalized)) {
    throw new Error(`Default agent not found: ${normalized}`);
  }
  return normalized;
}

async function handleProject(
  command: string,
  args: Record<string, unknown>,
  deps: XopcUseToolDeps,
  dryRun: boolean,
): Promise<unknown> {
  const projects = deps.getProjectService?.();
  if (!projects) return { ok: false, error: 'Project service is unavailable' };

  if (command === 'list') {
    return {
      ok: true,
      ...projects.list({
        status: enumValue(args.status, PROJECT_STATUSES),
        search: trimString(args.search),
        sortBy: enumValue(args.sortBy, new Set(['updatedAt', 'createdAt', 'name'] as const)),
        sortOrder: enumValue(args.sortOrder, new Set(['asc', 'desc'] as const)),
        limit: boundedLimit(args.limit),
        offset: offset(args.offset),
      }),
    };
  }

  if (command === 'get') {
    const id = trimString(args.projectId) ?? trimString(args.id);
    if (!id) return { ok: false, error: 'projectId is required' };
    const project = projects.getWithDetails(id);
    return project ? { ok: true, project } : { ok: false, error: `Project not found: ${id}` };
  }

  if (command === 'resolve_workspace') {
    const workspacePath = projectWorkspaceRootArg(args);
    if (!workspacePath) return { ok: false, error: 'workspacePath is required' };
    const defaultAgentId = args.defaultAgentId !== undefined
      ? validateDefaultAgentId(args.defaultAgentId, deps.getConfig?.()) ?? undefined
      : undefined;
    const input = {
      workspacePath,
      agentId: trimString(args.agentId),
      defaultAgentId,
      autoCreate: args.autoCreate === true,
    };
    if (dryRun) return { ok: true, dryRun: true, action: 'resolve_project_workspace', input };
    const match = projects.resolveOrCreateForWorkspacePath(input);
    return match ? { ok: true, match } : { ok: false, error: 'No project matched workspace path' };
  }

  if (command === 'create') {
    const name = trimString(args.name);
    const workspaceRoot = projectWorkspaceRootArg(args);
    if (!name && !workspaceRoot) return { ok: false, error: 'name or workspaceRoot is required' };
    const input = {
      name,
      description: trimString(args.description),
      defaultAgentId: validateDefaultAgentId(args.defaultAgentId, deps.getConfig?.()) ?? undefined,
      workspaceRoot,
      createWorkspaceRoot: args.createWorkspaceRoot === true,
      projectKind: trimString(args.projectKind),
      brief: trimString(args.brief),
      instructions: trimString(args.instructions),
    };
    if (dryRun) return { ok: true, dryRun: true, action: 'create_project', input };
    const project = projects.create(input);
    return { ok: true, project };
  }

  if (command === 'update') {
    const id = trimString(args.projectId) ?? trimString(args.id);
    if (!id) return { ok: false, error: 'projectId is required' };
    const workspaceRoot = optionalProjectWorkspaceRootArg(args);
    const patch = {
      ...(args.name !== undefined ? { name: trimString(args.name) ?? '' } : {}),
      ...(args.description !== undefined ? { description: optionalString(args.description) } : {}),
      ...(args.status !== undefined ? { status: enumValue(args.status, PROJECT_STATUSES) } : {}),
      ...(args.defaultAgentId !== undefined ? { defaultAgentId: validateDefaultAgentId(args.defaultAgentId, deps.getConfig?.()) } : {}),
      ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
      ...(args.createWorkspaceRoot === true ? { createWorkspaceRoot: true } : {}),
      ...(args.brief !== undefined ? { brief: optionalString(args.brief) } : {}),
      ...(args.instructions !== undefined ? { instructions: optionalString(args.instructions) } : {}),
    };
    if (args.status !== undefined && patch.status === undefined) return { ok: false, error: 'Invalid project status' };
    if (dryRun) return { ok: true, dryRun: true, action: 'update_project', projectId: id, patch };
    const project = projects.update(id, patch);
    return { ok: true, project };
  }

  return { ok: false, error: `Unsupported project command: ${command}` };
}

async function handleNote(
  command: string,
  args: Record<string, unknown>,
  deps: XopcUseToolDeps,
  dryRun: boolean,
): Promise<unknown> {
  const notes = deps.getNotesService?.();
  if (!notes) return { ok: false, error: 'Notes service is unavailable' };

  if (command === 'list') {
    const projectId = currentProjectId(args, deps);
    return {
      ok: true,
      ...(await notes.listNotes({
        status: enumValue(args.status, NOTE_STATUSES),
        kind: enumValue(args.kind, NOTE_KINDS),
        tag: trimString(args.tag),
        projectId,
        search: trimString(args.search),
        pinned: typeof args.pinned === 'boolean' ? args.pinned : undefined,
        limit: boundedLimit(args.limit),
        offset: offset(args.offset),
        sortBy: enumValue(args.sortBy, new Set(['createdAt', 'updatedAt', 'lastOpenedAt'] as const)),
        sortOrder: enumValue(args.sortOrder, new Set(['asc', 'desc'] as const)),
      })),
      ...(projectId ? { projectId } : {}),
    };
  }

  if (command === 'get') {
    const id = trimString(args.noteId) ?? trimString(args.id);
    if (!id) return { ok: false, error: 'noteId is required' };
    const note = await notes.getNote(id);
    return note ? { ok: true, note } : { ok: false, error: `Note not found: ${id}` };
  }

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
    const note = await notes.createNote(input);
    if (project) {
      new ObjectLinkService().create({
        id: `note:${note.id}:project:${project.id}`,
        from: { kind: 'note', id: note.id, title: note.title },
        to: { kind: 'project', id: project.id, title: project.name },
        relation: 'belongs_to',
        source: 'user',
      });
    }
    return { ok: true, note, ...(projectId ? { projectId } : {}) };
  }

  if (command === 'append') {
    const id = trimString(args.noteId) ?? trimString(args.id);
    const content = trimString(args.content);
    if (!id) return { ok: false, error: 'noteId is required' };
    if (!content) return { ok: false, error: 'content is required' };
    const heading = trimString(args.heading);
    if (dryRun) return { ok: true, dryRun: true, action: 'append_note', noteId: id, heading, content };
    const note = await notes.appendTextToNote(id, content, heading);
    return note ? { ok: true, note } : { ok: false, error: `Note not found: ${id}` };
  }

  if (command === 'preview_edit') {
    const id = trimString(args.noteId) ?? trimString(args.id);
    const instruction = trimString(args.instruction);
    if (!id) return { ok: false, error: 'noteId is required' };
    if (!instruction) return { ok: false, error: 'instruction is required' };
    const markdown = typeof args.markdown === 'string' ? args.markdown : undefined;
    const result = await notes.createAiEditPatch(id, instruction, markdown);
    return result ? { ok: true, ...result } : { ok: false, error: `Note not found: ${id}` };
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
    if (dryRun) return { ok: true, dryRun: true, action: 'update_note', noteId: id, patch };
    const note = await notes.updateNote(id, patch, 'ai_edit');
    return note ? { ok: true, note } : { ok: false, error: `Note not found: ${id}` };
  }

  return { ok: false, error: `Unsupported note command: ${command}` };
}

async function handleTask(
  command: string,
  args: Record<string, unknown>,
  deps: XopcUseToolDeps,
  dryRun: boolean,
): Promise<unknown> {
  const tasks = new TaskRepository();
  const dependencies = new TaskDependencyService();

  if (command === 'list') {
    const projectId = currentProjectId(args, deps);
    const status = enumValue(args.status, TASK_STATUSES);
    const priority = enumValue(args.priority, TASK_PRIORITIES);
    const search = trimString(args.search)?.toLocaleLowerCase();
    const start = offset(args.offset) ?? 0;
    const limit = boundedLimit(args.limit);
    const candidates = projectId
      ? tasks.listByProject(projectId, 200)
      : tasks.list({ limit: 200 });
    const matching = candidates.filter((task) =>
      (!status || task.status === status)
      && (!priority || task.priority === priority)
      && (!search || task.objective.toLocaleLowerCase().includes(search))
    );
    return {
      ok: true,
      items: matching.slice(start, start + limit),
      total: matching.length,
      ...(projectId ? { projectId } : {}),
    };
  }

  if (command === 'get') {
    const id = trimString(args.taskId) ?? trimString(args.id);
    if (!id) return { ok: false, error: 'taskId is required' };
    const task = tasks.get(id);
    return task
      ? {
          ok: true,
          task,
          dependencies: dependencies.listDependencies(id),
          dependents: dependencies.listDependents(id),
        }
      : { ok: false, error: `Task not found: ${id}` };
  }

  if (command === 'create') {
    const objective = trimString(args.objective) ?? trimString(args.title);
    if (!objective) return { ok: false, error: 'objective is required' };
    const createMode = args.createMode === undefined
      ? 'capture'
      : enumValue(args.createMode, TASK_CREATE_MODES);
    if (!createMode) return { ok: false, error: 'Invalid createMode' };
    if (createMode === 'start' && !deps.enqueueTask) {
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
    const sessionKey = trimString(args.sessionKey) ?? deps.getCurrentSessionKey?.();
    const input = {
      ...contract,
      createdBy: 'user' as const,
      priority,
      dueAt,
      requestId: trimString(args.requestId),
      agentId: trimString(args.agentId) ?? deps.getCurrentAgentId?.() ?? 'main',
      uiLocale: locale,
      source: 'chat' as const,
      projectId,
      contextText: trimString(args.contextText),
      links: [
        ...(projectId ? [{ kind: 'project' as const, id: projectId, relation: 'contains' }] : []),
        ...(sessionKey ? [{ kind: 'session' as const, id: sessionKey, relation: 'originated_from' }] : []),
      ],
    };
    if (dryRun) {
      return { ok: true, dryRun: true, action: 'create_task', createMode, input, dependsOnTaskIds };
    }
    let task = tasks.create(input);
    if (dependsOnTaskIds.length > 0) {
      task = dependencies.replace({
        taskId: task.id,
        dependsOnTaskIds,
        expectedUpdatedAt: task.updatedAt,
      });
    }
    if (createMode === 'capture') return { ok: true, task, createMode };
    const activation = new TaskCommandService(deps.enqueueTask!).execute({
      taskId: task.id,
      action: 'run',
      expectedUpdatedAt: task.updatedAt,
    });
    if (activation.ok === false) {
      return activation.reason === 'approval_required'
        ? {
            ok: true,
            task: activation.latest,
            createMode,
            activation: {
              status: 'needs_approval',
              requiredBoundaries: activation.requiredBoundaries,
            },
          }
        : { ok: false, error: `Task activation failed: ${activation.reason}`, ...activation };
    }
    return {
      ok: true,
      task: activation.task,
      createMode,
      activation: activation.queued
        ? { status: 'queued', queueId: activation.queued.id }
        : activation.waitingOn
          ? { status: 'waiting_dependency', dependencies: activation.waitingOn }
          : { status: 'started' },
    };
  }

  if (command === 'update_dependencies') {
    const id = trimString(args.taskId) ?? trimString(args.id);
    const expectedUpdatedAt = finiteNumber(args.expectedUpdatedAt);
    const dependsOnTaskIds = stringArray(args.dependsOnTaskIds);
    if (!id) return { ok: false, error: 'taskId is required' };
    if (expectedUpdatedAt === undefined || !Number.isInteger(expectedUpdatedAt) || expectedUpdatedAt < 0) {
      return { ok: false, error: 'expectedUpdatedAt is required' };
    }
    if (!dependsOnTaskIds) return { ok: false, error: 'dependsOnTaskIds is required' };
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        action: 'update_task_dependencies',
        taskId: id,
        expectedUpdatedAt,
        dependsOnTaskIds,
      };
    }
    try {
      const task = dependencies.replace({
        taskId: id,
        dependsOnTaskIds,
        expectedUpdatedAt,
      });
      return {
        ok: true,
        task,
        dependencies: dependencies.listDependencies(id),
        dependents: dependencies.listDependents(id),
      };
    } catch (error) {
      if (!(error instanceof TaskDependencyError)) throw error;
      return { ok: false, error: error.message, reason: error.code };
    }
  }

  if (command === 'action') {
    const id = trimString(args.taskId) ?? trimString(args.id);
    const action = enumValue(args.action, TASK_ACTIONS);
    const expectedUpdatedAt = finiteNumber(args.expectedUpdatedAt);
    const approvedBoundaries = args.approvedBoundaries === undefined
      ? undefined
      : stringArray(args.approvedBoundaries);
    if (!id) return { ok: false, error: 'taskId is required' };
    if (!action) return { ok: false, error: 'Invalid task action' };
    if (expectedUpdatedAt === undefined || !Number.isInteger(expectedUpdatedAt) || expectedUpdatedAt < 0) {
      return { ok: false, error: 'expectedUpdatedAt is required' };
    }
    if (args.approvedBoundaries !== undefined && !approvedBoundaries) {
      return { ok: false, error: 'Invalid approvedBoundaries' };
    }
    if ((action === 'run' || action === 'resume' || action === 'verify') && !deps.enqueueTask) {
      return { ok: false, error: 'Task execution service is unavailable' };
    }
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        action: 'execute_task_action',
        taskId: id,
        taskAction: action,
        expectedUpdatedAt,
        approvedBoundaries,
      };
    }
    const result = new TaskCommandService(
      deps.enqueueTask ?? (() => { throw new Error('Task execution service is unavailable'); }),
    ).execute({ taskId: id, action, expectedUpdatedAt, approvedBoundaries });
    if (result.ok === false) {
      return {
        ok: false,
        error: result.reason === 'not_found'
          ? `Task not found: ${id}`
          : result.reason === 'approval_required'
            ? 'Required execution boundaries must be approved'
            : result.reason === 'conflict'
              ? 'Task changed; refresh and try again'
              : 'Action is not valid for the current task state',
        action,
        ...result,
      };
    }
    return {
      ok: true,
      task: result.task,
      action,
      ...(result.queued ? { queued: result.queued } : {}),
      ...(result.waitingOn ? { waitingOn: result.waitingOn } : {}),
    };
  }

  return { ok: false, error: `Unsupported task command: ${command}` };
}

async function handleLocalApp(
  command: string,
  args: Record<string, unknown>,
  deps: XopcUseToolDeps,
  dryRun: boolean,
): Promise<unknown> {
  const localApps = deps.getLocalAppService?.();
  if (!localApps) return { ok: false, error: 'Local app service is unavailable' };

  if (command === 'list') {
    return { ok: true, apps: localApps.list() };
  }

  const id = trimString(args.localAppId) ?? trimString(args.id);
  if (command === 'get') {
    if (!id) return { ok: false, error: 'localAppId is required' };
    const app = localApps.get(id);
    return app ? { ok: true, app } : { ok: false, error: `Local app not found: ${id}` };
  }

  if (command === 'create') {
    const name = trimString(args.name);
    const idea = trimString(args.idea);
    if (!name) return { ok: false, error: 'name is required' };
    if (!idea) return { ok: false, error: 'idea is required' };
    const input = { name, idea, description: trimString(args.description) };
    if (dryRun) return { ok: true, dryRun: true, action: 'create_local_app', input };
    return { ok: true, app: localApps.create(input) };
  }

  if (command === 'validate') {
    if (!id) return { ok: false, error: 'localAppId is required' };
    const app = localApps.get(id);
    if (!app) return { ok: false, error: `Local app not found: ${id}` };
    return { ok: true, app, validation: localApps.validate(id) };
  }

  return { ok: false, error: `Unsupported local_app command: ${command}` };
}

function handleSettings(
  command: string,
  args: Record<string, unknown>,
): unknown {
  if (command !== 'open') {
    return { ok: false, error: `Unsupported settings command: ${command}` };
  }
  const section = trimString(args.section) ?? 'overview';
  if (!/^[a-z0-9][a-z0-9/_-]*$/i.test(section) || section.includes('..')) {
    return { ok: false, error: 'Invalid settings section' };
  }
  return {
    ok: true,
    settings: {
      section,
      title: trimString(args.title) ?? 'Settings',
      summary: trimString(args.summary),
    },
  };
}

export function createXopcUseTool(deps: XopcUseToolDeps): AgentTool<typeof XopcUseToolSchema, XopcUseDetails> {
  return {
    name: 'xopc_use',
    label: 'XOPC Use',
    description:
      'Operate first-class xopc objects through one safe entry point. Use for projects, notes, tasks, local apps, and exact settings jump targets instead of editing storage files directly. For non-trivial object changes, load the built-in manual first with tool_manual({ tool: "xopc_use" }).',
    parameters: XopcUseToolSchema,
    mutatesWorkspace: true,
    mutationScope: 'external',
    requiresExclusiveWorkspaceLock: true,
    finalGuardRelevant: true,
    async execute(toolCallId, input: XopcUseToolInput): Promise<AgentToolResult<XopcUseDetails>> {
      const mode = input.mode;
      const command = input.command.trim();
      const dryRun = input.dryRun === true;
      const args = ensureArgs(input);
      const details: XopcUseDetails = { mode, command, dryRun };
      if (!command) return errorText('command is required', details);

      try {
        const sessionKey = deps.getCurrentSessionKey?.();
        const agentId = deps.getCurrentAgentId?.();
        const result = await runWithActivityContext(
          {
            actor: { kind: 'agent', agentId, sessionKey },
            initiator: { kind: 'user', sessionKey },
            source: { kind: 'xopc_use', toolCallId },
          },
          async () =>
            mode === 'project'
              ? await handleProject(command, args, deps, dryRun)
              : mode === 'note'
                ? await handleNote(command, args, deps, dryRun)
                : mode === 'task'
                  ? await handleTask(command, args, deps, dryRun)
                  : mode === 'local_app'
                    ? await handleLocalApp(command, args, deps, dryRun)
                    : mode === 'settings'
                      ? handleSettings(command, args)
                      : { ok: false, error: `Unsupported mode: ${String(mode)}` },
        );
        return okText({
          ...details,
          result,
          delivery: deliveryForXopcResult(mode, command, result, dryRun),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorText(message, details);
      }
    },
  } as AgentTool<typeof XopcUseToolSchema, XopcUseDetails>;
}
