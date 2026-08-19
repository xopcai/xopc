import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  appendProductDeliveryText,
  WorkItemCommandSchema,
  WorkItemNextActionSchema,
  type ProductDeliveryEnvelope,
  type ProductReference,
} from '@xopcai/gateway-contract';

import { runWithActivityContext } from '../../activity/index.js';
import type { Config } from '../../config/schema.js';
import type { NoteKind, NotesService, NoteStatus } from '../../notes/index.js';
import {
  isValidProjectAgentId,
  normalizeProjectAgentId,
  type ProjectService,
  type ProjectStatus,
} from '../../projects/index.js';
import type {
  WorkItemPriority,
  WorkItemService,
  WorkItemCompletionPolicy,
  WorkItemPhase,
} from '../../work-items/index.js';
import type { LocalAppService } from '../../local-apps/index.js';
import { getSessionMetadata } from '../../storage/sqlite/index.js';

const XopcUseToolSchema = Type.Object({
  mode: Type.Union([
    Type.Literal('project'),
    Type.Literal('note'),
    Type.Literal('work_item'),
    Type.Literal('local_app'),
    Type.Literal('settings'),
  ]),
  command: Type.String({
    description:
      'Object command. Supports project list/get/create/update/resolve_workspace, note list/get/create/append/update/preview_edit, work_item list/get/create/update_metadata/execute_command/archive/unarchive, local_app list/get/create/validate, and settings open.',
  }),
  args: Type.Optional(Type.Record(Type.String(), Type.Any())),
  dryRun: Type.Optional(Type.Boolean({
    description: 'Validate and preview the action without mutating xopc state.',
  })),
});

export type XopcUseMode = 'project' | 'note' | 'work_item' | 'local_app' | 'settings';

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
  getWorkItemService?: () => WorkItemService | undefined;
  getLocalAppService?: () => LocalAppService | undefined;
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
const WORK_ITEM_PHASES = new Set<WorkItemPhase>(['backlog', 'ready', 'executing', 'verifying', 'closed']);
const WORK_ITEM_INITIAL_PHASES = new Set<Extract<WorkItemPhase, 'backlog' | 'ready'>>(['backlog', 'ready']);
const WORK_ITEM_PRIORITIES = new Set<WorkItemPriority>(['urgent', 'high', 'normal', 'low']);
const WORK_ITEM_COMPLETION_POLICIES = new Set<WorkItemCompletionPolicy>(['automatic', 'agent_verified', 'user_accepted']);

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

function nullableNumber(value: unknown): number | null | undefined {
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
        capabilities: ['open', 'preview', 'edit', 'continue_in_chat', 'share'],
      };
    }
  } else if (mode === 'work_item') {
    source = record(resultRecord.item);
    const id = deliveryText(source?.id);
    if (id) {
      primary = {
        kind: 'work_item',
        id,
        title: deliveryText(source?.title) ?? 'Work item',
        summary: deliverySummary(source?.description, source?.nextAction),
        status: deliveryText(source?.status),
        revision: deliveryRevision(source?.updatedAt),
        projectId: deliveryText(source?.projectId),
        capabilities: ['open', 'edit', 'continue_in_chat'],
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
    operation: command === 'create'
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
    return {
      ok: true,
      ...(await notes.listNotes({
        status: enumValue(args.status, NOTE_STATUSES),
        kind: enumValue(args.kind, NOTE_KINDS),
        tag: trimString(args.tag),
        search: trimString(args.search),
        pinned: typeof args.pinned === 'boolean' ? args.pinned : undefined,
        limit: boundedLimit(args.limit),
        offset: offset(args.offset),
        sortBy: enumValue(args.sortBy, new Set(['createdAt', 'updatedAt', 'lastOpenedAt'] as const)),
        sortOrder: enumValue(args.sortOrder, new Set(['asc', 'desc'] as const)),
      })),
    };
  }

  if (command === 'get') {
    const id = trimString(args.noteId) ?? trimString(args.id);
    if (!id) return { ok: false, error: 'noteId is required' };
    const note = await notes.getNote(id);
    return note ? { ok: true, note } : { ok: false, error: `Note not found: ${id}` };
  }

  if (command === 'create') {
    const markdown = typeof args.markdown === 'string' ? args.markdown : trimString(args.content) ?? '';
    const input = {
      title: trimString(args.title),
      markdown,
      kind: enumValue(args.kind, NOTE_KINDS),
      tags: stringArray(args.tags),
      capturedVia: { channel: 'web' as const },
      pinned: args.pinned === true,
    };
    if (dryRun) return { ok: true, dryRun: true, action: 'create_note', input };
    const note = await notes.createNote(input);
    return { ok: true, note };
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

async function handleWorkItem(
  command: string,
  args: Record<string, unknown>,
  deps: XopcUseToolDeps,
  dryRun: boolean,
): Promise<unknown> {
  const workItems = deps.getWorkItemService?.();
  if (!workItems) return { ok: false, error: 'Work item service is unavailable' };

  if (command === 'list') {
    const projectId = currentProjectId(args, deps);
    if (!projectId) return { ok: false, error: 'projectId is required' };
    return {
      ok: true,
      ...workItems.listProjectWorkItems(projectId, {
        phase: enumValue(args.phase, WORK_ITEM_PHASES),
        priority: enumValue(args.priority, WORK_ITEM_PRIORITIES),
        includeArchived: args.includeArchived === true,
        search: trimString(args.search),
        sortBy: enumValue(args.sortBy, new Set(['updatedAt', 'createdAt', 'priority', 'phase', 'dueAt'] as const)),
        sortOrder: enumValue(args.sortOrder, new Set(['asc', 'desc'] as const)),
        limit: boundedLimit(args.limit),
        offset: offset(args.offset),
      }),
    };
  }

  if (command === 'get') {
    const id = trimString(args.workItemId) ?? trimString(args.id);
    if (!id) return { ok: false, error: 'workItemId is required' };
    const item = workItems.getWorkItem(id);
    return item ? { ok: true, item } : { ok: false, error: `Work item not found: ${id}` };
  }

  if (command === 'create') {
    const projectId = currentProjectId(args, deps);
    const title = trimString(args.title);
    if (!projectId) return { ok: false, error: 'projectId is required' };
    if (!title) return { ok: false, error: 'title is required' };
    const input = {
      title,
      description: trimString(args.description),
      initialPhase: enumValue(args.initialPhase, WORK_ITEM_INITIAL_PHASES),
      priority: enumValue(args.priority, WORK_ITEM_PRIORITIES),
      ownerAgentId: trimString(args.ownerAgentId),
      completionPolicy: enumValue(args.completionPolicy, WORK_ITEM_COMPLETION_POLICIES),
      nextAction: WorkItemNextActionSchema.safeParse(args.nextAction).success
        ? WorkItemNextActionSchema.parse(args.nextAction)
        : undefined,
      dueAt: finiteNumber(args.dueAt),
    };
    if (args.initialPhase !== undefined && input.initialPhase === undefined) return { ok: false, error: 'Invalid initialPhase' };
    if (args.priority !== undefined && input.priority === undefined) return { ok: false, error: 'Invalid work item priority' };
    if (args.completionPolicy !== undefined && input.completionPolicy === undefined) return { ok: false, error: 'Invalid completionPolicy' };
    if (args.nextAction !== undefined && input.nextAction === undefined) return { ok: false, error: 'Invalid nextAction' };
    if (args.dueAt !== undefined && input.dueAt === undefined) return { ok: false, error: 'Invalid dueAt' };
    if (dryRun) return { ok: true, dryRun: true, action: 'create_work_item', projectId, input };
    const item = workItems.createProjectWorkItem(projectId, input);
    return { ok: true, item };
  }

  if (command === 'update_metadata') {
    const id = trimString(args.workItemId) ?? trimString(args.id);
    if (!id) return { ok: false, error: 'workItemId is required' };
    const expectedVersion = finiteNumber(args.expectedVersion);
    if (!expectedVersion || !Number.isInteger(expectedVersion)) return { ok: false, error: 'expectedVersion is required' };
    const dueAt = args.dueAt !== undefined ? nullableNumber(args.dueAt) : undefined;
    const nextAction = args.nextAction === null
      ? null
      : WorkItemNextActionSchema.safeParse(args.nextAction).success
        ? WorkItemNextActionSchema.parse(args.nextAction)
        : undefined;
    const patch = {
      ...(args.title !== undefined ? { title: trimString(args.title) ?? '' } : {}),
      ...(args.description !== undefined ? { description: optionalString(args.description) } : {}),
      ...(args.priority !== undefined ? { priority: enumValue(args.priority, WORK_ITEM_PRIORITIES) } : {}),
      ...(args.ownerAgentId !== undefined ? { ownerAgentId: optionalString(args.ownerAgentId) } : {}),
      ...(args.completionPolicy !== undefined ? { completionPolicy: enumValue(args.completionPolicy, WORK_ITEM_COMPLETION_POLICIES) } : {}),
      ...(args.nextAction !== undefined ? { nextAction } : {}),
      ...(args.dueAt !== undefined ? { dueAt } : {}),
    };
    if (args.priority !== undefined && patch.priority === undefined) return { ok: false, error: 'Invalid work item priority' };
    if (args.completionPolicy !== undefined && patch.completionPolicy === undefined) return { ok: false, error: 'Invalid completionPolicy' };
    if (args.nextAction !== undefined && nextAction === undefined) return { ok: false, error: 'Invalid nextAction' };
    if (args.dueAt !== undefined && dueAt === undefined) return { ok: false, error: 'Invalid dueAt' };
    if (dryRun) return { ok: true, dryRun: true, action: 'update_work_item_metadata', workItemId: id, expectedVersion, patch };
    const item = workItems.updateMetadata(id, patch, expectedVersion);
    return item ? { ok: true, item } : { ok: false, error: `Work item not found or version conflict: ${id}` };
  }

  if (command === 'execute_command') {
    const id = trimString(args.workItemId) ?? trimString(args.id);
    if (!id) return { ok: false, error: 'workItemId is required' };
    const parsed = WorkItemCommandSchema.safeParse(args);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid work item command' };
    if (dryRun) return { ok: true, dryRun: true, action: 'execute_work_item_command', workItemId: id, command: parsed.data };
    const item = workItems.executeCommand(id, parsed.data, {
      actor: { kind: 'agent', id: deps.getCurrentAgentId?.() ?? 'agent' },
      source: 'agent_tool',
      requestId: `xopc_use:${id}:${parsed.data.expectedVersion}`,
    });
    return item ? { ok: true, item } : { ok: false, error: `Work item not found: ${id}` };
  }

  if (command === 'archive' || command === 'unarchive') {
    const id = trimString(args.workItemId) ?? trimString(args.id);
    const expectedVersion = finiteNumber(args.expectedVersion);
    if (!id) return { ok: false, error: 'workItemId is required' };
    if (!expectedVersion || !Number.isInteger(expectedVersion)) return { ok: false, error: 'expectedVersion is required' };
    if (dryRun) return { ok: true, dryRun: true, action: command, workItemId: id, expectedVersion };
    const item = workItems.setArchived(id, command === 'archive', expectedVersion);
    return item ? { ok: true, item } : { ok: false, error: `Work item not found, open, or version conflict: ${id}` };
  }

  return { ok: false, error: `Unsupported work_item command: ${command}` };
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
      'Operate first-class xopc objects through one safe entry point. Use for projects, notes, project work items, local apps, and exact settings jump targets instead of editing storage files directly. For non-trivial object changes, load the built-in manual first with tool_manual({ tool: "xopc_use" }).',
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
                : mode === 'work_item'
                  ? await handleWorkItem(command, args, deps, dryRun)
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
