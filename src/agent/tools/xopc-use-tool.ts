import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

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
  WorkItemStatus,
} from '../../work-items/index.js';
import { getSessionMetadata } from '../../storage/sqlite/index.js';

const XopcUseToolSchema = Type.Object({
  mode: Type.Union([
    Type.Literal('project'),
    Type.Literal('note'),
    Type.Literal('work_item'),
  ]),
  command: Type.String({
    description:
      'Object command. Supports project list/get/create/update/resolve_workspace, note list/get/create/append/update/preview_edit, and work_item list/get/create/update.',
  }),
  args: Type.Optional(Type.Record(Type.String(), Type.Any())),
  dryRun: Type.Optional(Type.Boolean({
    description: 'Validate and preview the action without mutating xopc state.',
  })),
});

export type XopcUseMode = 'project' | 'note' | 'work_item';

export interface XopcUseToolInput {
  mode: XopcUseMode;
  command: string;
  args?: Record<string, unknown>;
  dryRun?: boolean;
}

export interface XopcUseToolDeps {
  getConfig?: () => Config | undefined;
  getCurrentSessionKey?: () => string | undefined;
  getNotesService?: () => NotesService | undefined;
  getProjectService?: () => ProjectService | undefined;
  getWorkItemService?: () => WorkItemService | undefined;
}

type XopcUseDetails = {
  mode: XopcUseMode;
  command: string;
  dryRun: boolean;
  result?: unknown;
};

const PROJECT_STATUSES = new Set<ProjectStatus>(['active', 'paused', 'archived']);
const NOTE_KINDS = new Set<NoteKind>(['thought', 'todo', 'voice', 'media', 'bookmark', 'mixed', 'task']);
const NOTE_STATUSES = new Set<NoteStatus>(['inbox', 'processed', 'archived', 'trashed']);
const WORK_ITEM_STATUSES = new Set<WorkItemStatus>([
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'needs_input',
  'in_review',
  'done',
  'cancelled',
]);
const WORK_ITEM_PRIORITIES = new Set<WorkItemPriority>(['urgent', 'high', 'normal', 'low']);

function okText(details: XopcUseDetails): AgentToolResult<XopcUseDetails> {
  return {
    content: [{ type: 'text', text: JSON.stringify(details.result ?? {}, null, 2) }],
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

function currentProjectId(args: Record<string, unknown>, deps: XopcUseToolDeps): string | undefined {
  const explicit = trimString(args.projectId);
  if (explicit) return explicit;
  const sessionKey = trimString(args.sessionKey) ?? deps.getCurrentSessionKey?.();
  return sessionKey ? getSessionMetadata(sessionKey)?.projectId : undefined;
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
    const workspacePath = trimString(args.workspacePath) ?? trimString(args.workspaceRoot);
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
    const workspaceRoot = trimString(args.workspaceRoot);
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
    const patch = {
      ...(args.name !== undefined ? { name: trimString(args.name) ?? '' } : {}),
      ...(args.description !== undefined ? { description: optionalString(args.description) } : {}),
      ...(args.status !== undefined ? { status: enumValue(args.status, PROJECT_STATUSES) } : {}),
      ...(args.defaultAgentId !== undefined ? { defaultAgentId: validateDefaultAgentId(args.defaultAgentId, deps.getConfig?.()) } : {}),
      ...(args.workspaceRoot !== undefined ? { workspaceRoot: optionalString(args.workspaceRoot) } : {}),
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
        status: enumValue(args.status, WORK_ITEM_STATUSES),
        priority: enumValue(args.priority, WORK_ITEM_PRIORITIES),
        includeArchived: args.includeArchived === true,
        search: trimString(args.search),
        sortBy: enumValue(args.sortBy, new Set(['updatedAt', 'createdAt', 'priority', 'status'] as const)),
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
      status: enumValue(args.status, WORK_ITEM_STATUSES),
      priority: enumValue(args.priority, WORK_ITEM_PRIORITIES),
      ownerAgentId: trimString(args.ownerAgentId),
      nextAction: trimString(args.nextAction),
      blockedReason: trimString(args.blockedReason),
      dueAt: finiteNumber(args.dueAt),
    };
    if (args.status !== undefined && input.status === undefined) return { ok: false, error: 'Invalid work item status' };
    if (args.priority !== undefined && input.priority === undefined) return { ok: false, error: 'Invalid work item priority' };
    if (args.dueAt !== undefined && input.dueAt === undefined) return { ok: false, error: 'Invalid dueAt' };
    if (dryRun) return { ok: true, dryRun: true, action: 'create_work_item', projectId, input };
    const item = workItems.createProjectWorkItem(projectId, input);
    return { ok: true, item };
  }

  if (command === 'update') {
    const id = trimString(args.workItemId) ?? trimString(args.id);
    if (!id) return { ok: false, error: 'workItemId is required' };
    const dueAt = args.dueAt !== undefined ? nullableNumber(args.dueAt) : undefined;
    const archivedAt = args.archivedAt !== undefined ? nullableNumber(args.archivedAt) : undefined;
    const patch = {
      ...(args.title !== undefined ? { title: trimString(args.title) ?? '' } : {}),
      ...(args.description !== undefined ? { description: optionalString(args.description) } : {}),
      ...(args.status !== undefined ? { status: enumValue(args.status, WORK_ITEM_STATUSES) } : {}),
      ...(args.priority !== undefined ? { priority: enumValue(args.priority, WORK_ITEM_PRIORITIES) } : {}),
      ...(args.ownerAgentId !== undefined ? { ownerAgentId: optionalString(args.ownerAgentId) } : {}),
      ...(args.nextAction !== undefined ? { nextAction: optionalString(args.nextAction) } : {}),
      ...(args.blockedReason !== undefined ? { blockedReason: optionalString(args.blockedReason) } : {}),
      ...(args.dueAt !== undefined ? { dueAt } : {}),
      ...(args.archivedAt !== undefined ? { archivedAt } : {}),
    };
    if (args.status !== undefined && patch.status === undefined) return { ok: false, error: 'Invalid work item status' };
    if (args.priority !== undefined && patch.priority === undefined) return { ok: false, error: 'Invalid work item priority' };
    if (args.dueAt !== undefined && dueAt === undefined) return { ok: false, error: 'Invalid dueAt' };
    if (args.archivedAt !== undefined && archivedAt === undefined) return { ok: false, error: 'Invalid archivedAt' };
    if (dryRun) return { ok: true, dryRun: true, action: 'update_work_item', workItemId: id, patch };
    const item = workItems.updateWorkItem(id, patch);
    return item ? { ok: true, item } : { ok: false, error: `Work item not found: ${id}` };
  }

  return { ok: false, error: `Unsupported work_item command: ${command}` };
}

export function createXopcUseTool(deps: XopcUseToolDeps): AgentTool<typeof XopcUseToolSchema, XopcUseDetails> {
  return {
    name: 'xopc_use',
    label: 'XOPC Use',
    description:
      'Operate first-class xopc objects through one safe entry point. Use for projects, notes, and project work items instead of editing storage files directly. For non-trivial object changes, load the built-in manual first with tool_manual({ tool: "xopc_use" }).',
    parameters: XopcUseToolSchema,
    mutatesWorkspace: true,
    mutationScope: 'external',
    requiresExclusiveWorkspaceLock: true,
    finalGuardRelevant: true,
    async execute(_toolCallId, input: XopcUseToolInput): Promise<AgentToolResult<XopcUseDetails>> {
      const mode = input.mode;
      const command = input.command.trim();
      const dryRun = input.dryRun === true;
      const args = ensureArgs(input);
      const details: XopcUseDetails = { mode, command, dryRun };
      if (!command) return errorText('command is required', details);

      try {
        const result =
          mode === 'project'
            ? await handleProject(command, args, deps, dryRun)
            : mode === 'note'
              ? await handleNote(command, args, deps, dryRun)
              : mode === 'work_item'
                ? await handleWorkItem(command, args, deps, dryRun)
                : { ok: false, error: `Unsupported mode: ${String(mode)}` };
        return okText({ ...details, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorText(message, details);
      }
    },
  } as AgentTool<typeof XopcUseToolSchema, XopcUseDetails>;
}
