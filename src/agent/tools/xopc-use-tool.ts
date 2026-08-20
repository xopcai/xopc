import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  appendProductDeliveryText,
  TaskContextInputSchema,
  type TaskCommand,
  TaskCommandSchema,
  type TaskPhase,
  type TaskPriority,
  type ProductDeliveryEnvelope,
  type ProductReference,
} from '@xopcai/gateway-contract';

import { ObjectLinkService, runWithActivityContext } from '../../activity/index.js';
import type { Config } from '../../config/schema.js';
import type { NoteKind, NotesService, NoteStatus } from '../../notes/index.js';
import {
  isValidProjectAgentId,
  normalizeProjectAgentId,
  type ProjectHealth,
  type ProjectMilestone,
  type ProjectService,
  type ProjectStatus,
} from '../../projects/index.js';
import type { LocalAppService } from '../../local-apps/index.js';
import { getSessionMetadata } from '../../storage/sqlite/index.js';
import {
  defineTaskContract,
  TaskApplicationService,
  TaskContextRepository,
  TaskReadModelProjector,
  TaskRepository,
  TaskRunRepository,
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
    Type.Literal('task_run'),
    Type.Literal('local_app'),
    Type.Literal('settings'),
  ]),
  command: Type.String({
    description:
      'Object command. Supports project list/get/create/update/resolve_workspace/list_milestones/create_milestone/update_milestone/list_updates/create_update, note list/get/create/append/update/preview_edit, task list/get/create/update_dependencies/add_context/remove_context/command, task_run list/get/cancel, local_app list/get/create/validate, and settings open.',
  }),
  args: Type.Optional(Type.Record(Type.String(), Type.Any())),
  dryRun: Type.Optional(Type.Boolean({
    description: 'Validate and preview the action without mutating xopc state.',
  })),
});

export type XopcUseMode = 'project' | 'note' | 'task' | 'task_run' | 'local_app' | 'settings';

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
  dispatchTaskRuns?: () => void;
}

type XopcUseDetails = {
  mode: XopcUseMode;
  command: string;
  dryRun: boolean;
  result?: unknown;
  delivery?: ProductDeliveryEnvelope;
};

const PROJECT_STATUSES = new Set<ProjectStatus>([
  'planned', 'active', 'paused', 'completed', 'cancelled', 'archived',
]);
const PROJECT_HEALTHS = new Set<ProjectHealth>(['unknown', 'on_track', 'at_risk', 'off_track']);
const MILESTONE_STATUSES = new Set<ProjectMilestone['status']>([
  'planned', 'active', 'completed', 'cancelled',
]);
const NOTE_KINDS = new Set<NoteKind>(['thought', 'todo', 'voice', 'media', 'bookmark', 'mixed', 'task']);
const NOTE_STATUSES = new Set<NoteStatus>(['inbox', 'processed', 'archived', 'trashed']);
const TASK_PHASES = new Set<TaskPhase>(['backlog', 'ready', 'active', 'review', 'closed']);
const TASK_PRIORITIES = new Set<TaskPriority>(['low', 'normal', 'high', 'critical']);
const TASK_COMMANDS = new Set<TaskCommand['type']>([
  'mark_ready', 'start', 'request_review', 'close', 'reopen',
  'add_wait', 'resolve_wait', 'delegate', 'revise_contract',
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

function nullableFiniteNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return finiteNumber(value);
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
  return {
    version: 1,
    operation: mode === 'task' && deliveryText(resultRecord.runId)
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
      outcome: trimString(args.outcome),
      successCriteria: args.successCriteria === undefined ? undefined : stringArray(args.successCriteria),
      scope: args.scope === undefined ? undefined : record(args.scope),
      nonGoals: args.nonGoals === undefined ? undefined : stringArray(args.nonGoals),
      health: args.health === undefined ? undefined : enumValue(args.health, PROJECT_HEALTHS),
      ownerId: trimString(args.ownerId),
      targetAt: args.targetAt === undefined ? undefined : finiteNumber(args.targetAt),
    };
    if (args.successCriteria !== undefined && !input.successCriteria) return { ok: false, error: 'Invalid successCriteria' };
    if (args.scope !== undefined && !input.scope) return { ok: false, error: 'Invalid scope' };
    if (args.nonGoals !== undefined && !input.nonGoals) return { ok: false, error: 'Invalid nonGoals' };
    if (args.health !== undefined && !input.health) return { ok: false, error: 'Invalid project health' };
    if (args.targetAt !== undefined && input.targetAt === undefined) return { ok: false, error: 'Invalid targetAt' };
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
      ...(args.outcome !== undefined ? { outcome: optionalString(args.outcome) } : {}),
      ...(args.successCriteria !== undefined ? { successCriteria: stringArray(args.successCriteria) } : {}),
      ...(args.scope !== undefined ? { scope: record(args.scope) } : {}),
      ...(args.nonGoals !== undefined ? { nonGoals: stringArray(args.nonGoals) } : {}),
      ...(args.health !== undefined ? { health: enumValue(args.health, PROJECT_HEALTHS) } : {}),
      ...(args.ownerId !== undefined ? { ownerId: optionalString(args.ownerId) } : {}),
      ...(args.targetAt !== undefined ? { targetAt: nullableFiniteNumber(args.targetAt) } : {}),
    };
    if (args.status !== undefined && patch.status === undefined) return { ok: false, error: 'Invalid project status' };
    if (args.successCriteria !== undefined && patch.successCriteria === undefined) return { ok: false, error: 'Invalid successCriteria' };
    if (args.scope !== undefined && patch.scope === undefined) return { ok: false, error: 'Invalid scope' };
    if (args.nonGoals !== undefined && patch.nonGoals === undefined) return { ok: false, error: 'Invalid nonGoals' };
    if (args.health !== undefined && patch.health === undefined) return { ok: false, error: 'Invalid project health' };
    if (args.targetAt !== undefined && patch.targetAt === undefined) return { ok: false, error: 'Invalid targetAt' };
    if (dryRun) return { ok: true, dryRun: true, action: 'update_project', projectId: id, patch };
    const project = projects.update(id, patch);
    return { ok: true, project };
  }

  const projectId = trimString(args.projectId) ?? trimString(args.id);
  if (command === 'list_milestones') {
    if (!projectId) return { ok: false, error: 'projectId is required' };
    return { ok: true, projectId, items: projects.listMilestones(projectId) };
  }

  if (command === 'create_milestone') {
    if (!projectId) return { ok: false, error: 'projectId is required' };
    const title = trimString(args.title);
    const status = args.status === undefined ? undefined : enumValue(args.status, MILESTONE_STATUSES);
    const targetAt = args.targetAt === undefined ? undefined : finiteNumber(args.targetAt);
    const sortOrder = args.sortOrder === undefined ? undefined : finiteNumber(args.sortOrder);
    if (!title) return { ok: false, error: 'title is required' };
    if (args.status !== undefined && !status) return { ok: false, error: 'Invalid milestone status' };
    if (args.targetAt !== undefined && targetAt === undefined) return { ok: false, error: 'Invalid targetAt' };
    if (args.sortOrder !== undefined && sortOrder === undefined) return { ok: false, error: 'Invalid sortOrder' };
    const input = { title, description: trimString(args.description), status, targetAt, sortOrder };
    if (dryRun) return { ok: true, dryRun: true, action: 'create_project_milestone', projectId, input };
    return {
      ok: true,
      milestone: projects.createMilestone(projectId, input),
      project: projects.get(projectId),
    };
  }

  if (command === 'update_milestone') {
    if (!projectId) return { ok: false, error: 'projectId is required' };
    const milestoneId = trimString(args.milestoneId);
    if (!milestoneId) return { ok: false, error: 'milestoneId is required' };
    const patch = {
      ...(args.title !== undefined ? { title: trimString(args.title) ?? '' } : {}),
      ...(args.description !== undefined ? { description: optionalString(args.description) } : {}),
      ...(args.status !== undefined ? { status: enumValue(args.status, MILESTONE_STATUSES) } : {}),
      ...(args.targetAt !== undefined ? { targetAt: nullableFiniteNumber(args.targetAt) } : {}),
      ...(args.sortOrder !== undefined ? { sortOrder: finiteNumber(args.sortOrder) } : {}),
    };
    if (args.status !== undefined && patch.status === undefined) return { ok: false, error: 'Invalid milestone status' };
    if (args.targetAt !== undefined && patch.targetAt === undefined) return { ok: false, error: 'Invalid targetAt' };
    if (args.sortOrder !== undefined && patch.sortOrder === undefined) return { ok: false, error: 'Invalid sortOrder' };
    if (dryRun) return { ok: true, dryRun: true, action: 'update_project_milestone', projectId, milestoneId, patch };
    return {
      ok: true,
      milestone: projects.updateMilestone(projectId, milestoneId, patch),
      project: projects.get(projectId),
    };
  }

  if (command === 'list_updates') {
    if (!projectId) return { ok: false, error: 'projectId is required' };
    return { ok: true, projectId, items: projects.listUpdates(projectId, boundedLimit(args.limit)) };
  }

  if (command === 'create_update') {
    if (!projectId) return { ok: false, error: 'projectId is required' };
    const health = enumValue(args.health, PROJECT_HEALTHS);
    const summary = trimString(args.summary);
    const progress = args.progress === undefined ? undefined : stringArray(args.progress);
    const risks = args.risks === undefined ? undefined : stringArray(args.risks);
    const nextSteps = args.nextSteps === undefined ? undefined : stringArray(args.nextSteps);
    if (!health) return { ok: false, error: 'health is required' };
    if (!summary) return { ok: false, error: 'summary is required' };
    if (args.progress !== undefined && !progress) return { ok: false, error: 'Invalid progress' };
    if (args.risks !== undefined && !risks) return { ok: false, error: 'Invalid risks' };
    if (args.nextSteps !== undefined && !nextSteps) return { ok: false, error: 'Invalid nextSteps' };
    const input = {
      health,
      summary,
      progress,
      risks,
      nextSteps,
      actor: { kind: 'agent', agentId: deps.getCurrentAgentId?.(), sessionKey: deps.getCurrentSessionKey?.() },
    };
    if (dryRun) return { ok: true, dryRun: true, action: 'create_project_update', projectId, input };
    return {
      ok: true,
      update: projects.createUpdate(projectId, input),
      project: projects.get(projectId),
    };
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
  const context = new TaskContextRepository();
  const runs = new TaskRunRepository();
  const projector = new TaskReadModelProjector();

  if (command === 'list') {
    const projectId = currentProjectId(args, deps);
    const phase = enumValue(args.phase, TASK_PHASES);
    const priority = enumValue(args.priority, TASK_PRIORITIES);
    const search = trimString(args.search)?.toLocaleLowerCase();
    const start = offset(args.offset) ?? 0;
    const limit = boundedLimit(args.limit);
    const candidates = projectId
      ? tasks.listByProject(projectId, 200)
      : tasks.list({ limit: 200 });
    const matching = candidates.filter((task) =>
      (!phase || task.phase === phase)
      && (!priority || task.priority === priority)
      && (!search || `${task.title}\n${task.contract?.objective ?? ''}`.toLocaleLowerCase().includes(search))
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
    if (!task) return { ok: false, error: `Task not found: ${id}` };
    const model = projector.project(task);
    return {
      ok: true,
      task,
      model,
      operationalState: model.operationalState,
      attention: model.attention,
      allowedCommands: model.allowedCommands,
      dependencies: dependencies.listDependencies(id),
      dependents: dependencies.listDependents(id),
      context: context.list(id),
      authorityGrants: context.listActiveGrants(id),
      runs: runs.listByTask(id),
      receipts: runs.listReceipts(id),
      waits: runs.listActiveWaits(id),
    };
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
    const sessionKey = trimString(args.sessionKey) ?? deps.getCurrentSessionKey?.();
    const agentId = trimString(args.agentId) ?? deps.getCurrentAgentId?.() ?? 'main';
    const input = {
      idempotencyKey: trimString(args.idempotencyKey) ?? randomUUID(),
      title: trimString(args.title) ?? objective,
      priority: priority ?? 'normal' as const,
      ...(dueAt === undefined ? {} : { dueAt }),
      ...(projectId ? { projectId } : {}),
      ...(locale ? { locale } : {}),
      contract: {
        ...contract,
        acceptancePolicy: 'verified_auto' as const,
        outputDestinations: [],
      },
      dependencies: dependsOnTaskIds,
      context: sessionKey ? [{
        targetKind: 'session' as const,
        targetId: sessionKey,
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
    const created = new TaskApplicationService().create(input, { kind: 'agent', id: agentId });
    if (created.ok === false) return { ok: false, error: created.reason, ...created };
    if (created.runId) deps.dispatchTaskRuns?.();
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
    try {
      const task = dependencies.replace({
        taskId: id,
        dependsOnTaskIds,
        expectedVersion,
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
    return { ok: true, edge: context.add(input), context: context.list(id) };
  }

  if (command === 'remove_context') {
    const id = trimString(args.taskId) ?? trimString(args.id);
    const edgeId = trimString(args.edgeId);
    if (!id) return { ok: false, error: 'taskId is required' };
    if (!edgeId) return { ok: false, error: 'edgeId is required' };
    if (dryRun) return { ok: true, dryRun: true, action: 'remove_task_context', taskId: id, edgeId };
    const removed = context.remove(id, edgeId);
    return removed
      ? { ok: true, taskId: id, edgeId, context: context.list(id) }
      : { ok: false, error: `Task context edge not found: ${edgeId}` };
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
    const result = new TaskApplicationService().execute({
      taskId: id,
      idempotencyKey: trimString(args.idempotencyKey) ?? randomUUID(),
      expectedVersion,
      command: parsedCommand.data,
      actor: { kind: 'agent', id: deps.getCurrentAgentId?.() },
    });
    if (result.ok === false) {
      return {
        ok: false,
        error: result.reason,
        command: parsedCommand.data,
        ...result,
      };
    }
    if (result.runId) deps.dispatchTaskRuns?.();
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
): Promise<unknown> {
  const runs = new TaskRunRepository();

  if (command === 'list') {
    const taskId = trimString(args.taskId);
    if (!taskId) return { ok: false, error: 'taskId is required' };
    const limit = boundedLimit(args.limit);
    return {
      ok: true,
      taskId,
      items: runs.listByTask(taskId).slice(0, limit),
      receipts: runs.listReceipts(taskId, limit),
      activeWaits: runs.listActiveWaits(taskId),
    };
  }

  if (command === 'get') {
    const runId = trimString(args.runId) ?? trimString(args.id);
    if (!runId) return { ok: false, error: 'runId is required' };
    const run = runs.get(runId);
    if (!run) return { ok: false, error: `TaskRun not found: ${runId}` };
    return {
      ok: true,
      run,
      receipt: runs.getReceipt(runId),
      events: runs.listEvents(runId),
      activeWaits: runs.listActiveWaits(run.taskId),
    };
  }

  if (command === 'cancel') {
    const runId = trimString(args.runId) ?? trimString(args.id);
    const expectedVersion = finiteNumber(args.expectedVersion);
    if (!runId) return { ok: false, error: 'runId is required' };
    if (expectedVersion === undefined || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return { ok: false, error: 'expectedVersion is required' };
    }
    const run = runs.get(runId);
    if (!run) return { ok: false, error: `TaskRun not found: ${runId}` };
    if (run.version !== expectedVersion) {
      return { ok: false, error: 'TaskRun changed', reason: 'conflict', run };
    }
    const task = new TaskRepository().require(run.taskId);
    const reason = trimString(args.reason) ?? 'TaskRun cancelled by agent';
    if (dryRun) {
      return { ok: true, dryRun: true, action: 'cancel_task_run', runId, expectedVersion, reason };
    }
    const result = new TaskApplicationService().completeRun({
      runId,
      expectedRunVersion: expectedVersion,
      actor: { kind: 'agent', id: deps.getCurrentAgentId?.() },
      terminalCode: 'cancelled_by_agent',
      terminalMessage: reason,
      receipt: {
        status: 'cancelled',
        summary: reason,
        changes: [],
        evidence: [],
        verification: { status: 'unverified', checks: [] },
        remainingWork: [task.contract?.objective ?? task.title],
        needsUser: false,
        completionVerdict: 'not_achieved',
      },
    });
    if (result.ok === false) return { ok: false, error: result.reason, ...result };
    return { ok: true, run: runs.get(runId), receipt: runs.getReceipt(runId), model: result.model };
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
      'Operate first-class xopc objects through one safe entry point. Use for projects, notes, tasks, TaskRuns, local apps, and exact settings jump targets instead of editing storage files directly. For non-trivial object changes, load the built-in manual first with tool_manual({ tool: "xopc_use" }).',
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
                  : mode === 'task_run'
                    ? await handleTaskRun(command, args, dryRun, deps)
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
import { randomUUID } from 'node:crypto';
