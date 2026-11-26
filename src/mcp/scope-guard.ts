import { ObjectLinkService } from '../activity/service.js';
import type { FileSpaceService } from '../files/file-service.js';
import { NotesStore } from '../notes/store.js';
import type { ProjectService } from '../projects/project-service.js';
import { getSessionMetadata } from '../storage/sqlite/session-read-repository.js';
import { TaskRepository } from '../tasks/task-repository.js';
import { TaskRunRepository } from '../tasks/task-run-repository.js';

export interface McpProjectScopeDeps {
  getProjects?: () => ProjectService | undefined;
  getFiles?: () => FileSpaceService | undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function noteMatchesProjects(
  noteId: string | undefined,
  inline: unknown,
  allowedProjects: ReadonlySet<string>,
  objectLinks: ObjectLinkService,
): boolean {
  if (inline && typeof inline === 'object') {
    const obj = inline as { projectId?: unknown; projects?: unknown };
    if (typeof obj.projectId === 'string' && allowedProjects.has(obj.projectId)) return true;
    if (Array.isArray(obj.projects) && obj.projects.some(
      project => project && typeof project === 'object' && typeof (project as { id?: unknown }).id === 'string'
        && allowedProjects.has((project as { id: string }).id),
    )) {
      return true;
    }
  }
  if (!noteId) return false;
  try {
    const links = objectLinks.listForObject({ kind: 'note', id: noteId });
    return links.some(link =>
      (link.to.kind === 'project' && allowedProjects.has(link.to.id))
      || (link.from.kind === 'project' && allowedProjects.has(link.from.id)),
    );
  } catch {
    return false;
  }
}

/**
 * Enforces project-scoped isolation (`grant.projectIds`) before executing a capability.
 * When `projectIds` is undefined or empty, full personal workspace access applies.
 */
export function createMcpProjectScopeAuthorizer(
  capabilityIds: readonly string[],
  projectIds: readonly string[] | undefined,
  deps: McpProjectScopeDeps = {},
): (capabilityId: string, input: unknown) => Promise<boolean> {
  const allowedTools = new Set(capabilityIds);
  const allowedProjects = projectIds?.length ? new Set(projectIds) : undefined;
  const tasks = new TaskRepository();
  const runs = new TaskRunRepository();
  const notes = new NotesStore();
  const objectLinks = new ObjectLinkService();

  return async (capabilityId: string, rawInput: unknown): Promise<boolean> => {
    if (!allowedTools.has(capabilityId)) return false;
    if (!allowedProjects) return true;

    const input = asObject(rawInput);

    // Project capabilities
    if (capabilityId === 'xopc.projects.list') return true;
    if (capabilityId === 'xopc.projects.create') return false;
    if (capabilityId.startsWith('xopc.projects.')) {
      const targetProjectId = stringField(input, 'projectId') ?? stringField(input, 'id');
      return Boolean(targetProjectId && allowedProjects.has(targetProjectId));
    }

    // Task capabilities
    if (capabilityId === 'xopc.tasks.list') {
      const targetProjectId = stringField(input, 'projectId');
      return !targetProjectId || allowedProjects.has(targetProjectId);
    }
    if (capabilityId === 'xopc.tasks.create') {
      const targetProjectId = stringField(input, 'projectId');
      return Boolean(targetProjectId && allowedProjects.has(targetProjectId));
    }
    if (capabilityId.startsWith('xopc.tasks.')) {
      const taskId = stringField(input, 'taskId') ?? stringField(input, 'id');
      const task = taskId ? tasks.get(taskId) : undefined;
      if (!task?.projectId || !allowedProjects.has(task.projectId)) return false;
      const nextProjectId = stringField(input, 'projectId');
      if (nextProjectId && !allowedProjects.has(nextProjectId)) return false;
      return true;
    }

    // Task run capabilities
    if (capabilityId === 'xopc.task_runs.list') {
      const taskId = stringField(input, 'taskId');
      const task = taskId ? tasks.get(taskId) : undefined;
      return Boolean(task?.projectId && allowedProjects.has(task.projectId));
    }
    if (capabilityId === 'xopc.task_runs.get' || capabilityId === 'xopc.task_runs.feedback') {
      const runId = stringField(input, 'id') ?? stringField(input, 'runId');
      const run = runId ? runs.get(runId) : undefined;
      const task = run ? tasks.get(run.taskId) : undefined;
      return Boolean(task?.projectId && allowedProjects.has(task.projectId));
    }

    // Note capabilities
    if (capabilityId === 'xopc.notes.list' || capabilityId === 'xopc.notes.project_summaries') {
      const targetProjectId = stringField(input, 'projectId');
      return !targetProjectId || allowedProjects.has(targetProjectId);
    }
    if (capabilityId === 'xopc.notes.create' || capabilityId === 'xopc.notes.capture') {
      const targetProjectId = stringField(input, 'projectId');
      return Boolean(targetProjectId && allowedProjects.has(targetProjectId));
    }
    if (capabilityId.startsWith('xopc.notes.')) {
      const noteId = stringField(input, 'id') ?? stringField(input, 'noteId');
      const note = noteId ? notes.getNote(noteId) : undefined;
      return Boolean(note && noteMatchesProjects(note.id, note, allowedProjects, objectLinks));
    }

    // File capabilities
    if (capabilityId === 'xopc.files.spaces' || capabilityId === 'xopc.files.search') {
      const targetProjectId = stringField(input, 'projectId');
      if (targetProjectId && !allowedProjects.has(targetProjectId)) return false;
      const spaceId = stringField(input, 'spaceId');
      if (spaceId && deps.getFiles) {
        const space = await deps.getFiles()?.get(spaceId).catch(() => undefined);
        return Boolean(space?.bindings.some(binding => binding.kind === 'project' && allowedProjects.has(binding.id)));
      }
      return true;
    }
    if (capabilityId === 'xopc.files.list') {
      const spaceId = stringField(input, 'spaceId');
      if (!spaceId || !deps.getFiles) return false;
      const space = await deps.getFiles()?.get(spaceId).catch(() => undefined);
      return Boolean(space?.bindings.some(binding => binding.kind === 'project' && allowedProjects.has(binding.id)));
    }
    if (capabilityId === 'xopc.files.get') {
      const fileId = stringField(input, 'id');
      if (!fileId || !deps.getFiles) return false;
      const resolved = await deps.getFiles()?.resource(fileId).catch(() => undefined);
      return Boolean(resolved?.space.bindings.some(binding => binding.kind === 'project' && allowedProjects.has(binding.id)));
    }

    // Delegation capabilities
    if (capabilityId === 'xopc.agent_runs.start') {
      const targetProjectId = stringField(input, 'projectId');
      if (!targetProjectId || !allowedProjects.has(targetProjectId)) return false;
      const refs = Array.isArray(input.references) ? input.references : [];
      for (const item of refs) {
        const ref = asObject(item);
        const kind = stringField(ref, 'kind');
        const id = stringField(ref, 'id');
        if (!kind || !id) return false;
        if (kind === 'project' && !allowedProjects.has(id)) return false;
        if (kind === 'task') {
          const task = tasks.get(id);
          if (!task?.projectId || !allowedProjects.has(task.projectId)) return false;
        }
        if (kind === 'note') {
          const note = notes.getNote(id);
          if (!note || !noteMatchesProjects(note.id, note, allowedProjects, objectLinks)) return false;
        }
        if (kind === 'file' && deps.getFiles) {
          const resolved = await deps.getFiles()?.resource(id).catch(() => undefined);
          if (!resolved?.space.bindings.some(binding => binding.kind === 'project' && allowedProjects.has(binding.id))) {
            return false;
          }
        }
      }
      return true;
    }

    // Workspace search, user context & sessions
    if (capabilityId === 'xopc.workspace.search' || capabilityId === 'xopc.user_context.profile'
      || capabilityId === 'xopc.knowledge.list' || capabilityId === 'xopc.knowledge.search'
      || capabilityId === 'xopc.sessions.list' || capabilityId === 'xopc.sessions.search') {
      const targetProjectId = stringField(input, 'projectId');
      return !targetProjectId || allowedProjects.has(targetProjectId);
    }
    if (capabilityId === 'xopc.sessions.read') {
      const conversationId = stringField(input, 'conversationId');
      const sessionMeta = conversationId ? getSessionMetadata(conversationId) : null;
      return Boolean(sessionMeta?.projectId && allowedProjects.has(sessionMeta.projectId));
    }

    // Automations
    if (capabilityId === 'xopc.automations.list') {
      const targetProjectId = stringField(input, 'projectId');
      return !targetProjectId || allowedProjects.has(targetProjectId);
    }

    return true;
  };
}

/**
 * Post-filters list/search outputs so project-scoped grants never leak out-of-scope records.
 */
export function filterMcpOutputForProjects(
  capabilityId: string,
  result: unknown,
  projectIds: readonly string[] | undefined,
): unknown {
  if (!projectIds?.length || !result || typeof result !== 'object') return result;
  const allowed = new Set(projectIds);
  const record = result as Record<string, unknown>;

  if (capabilityId === 'xopc.projects.list' && Array.isArray(record.items)) {
    const items = record.items.filter(item => typeof (item as { id?: unknown })?.id === 'string' && allowed.has((item as { id: string }).id));
    return { ...record, items, total: items.length };
  }
  if (capabilityId === 'xopc.tasks.list' && Array.isArray(record.items)) {
    const items = record.items.filter(item => {
      const task = (item as { task?: { projectId?: string } })?.task;
      return Boolean(task?.projectId && allowed.has(task.projectId));
    });
    return { ...record, items, total: items.length };
  }
  if (capabilityId === 'xopc.notes.list' && Array.isArray(record.items)) {
    const objectLinks = new ObjectLinkService();
    const items = record.items.filter(item => {
      const candidate = item as { id?: string };
      return noteMatchesProjects(candidate.id, candidate, allowed, objectLinks);
    });
    return { ...record, items, total: items.length };
  }
  if (capabilityId === 'xopc.notes.project_summaries' && Array.isArray(record.summaries)) {
    return {
      ...record,
      summaries: record.summaries.filter(item => {
        const summary = item as { id?: string; projectId?: string };
        const pid = summary.projectId ?? summary.id;
        return Boolean(pid && allowed.has(pid));
      }),
    };
  }
  if (capabilityId === 'xopc.files.spaces' && Array.isArray(record.spaces)) {
    return {
      ...record,
      spaces: record.spaces.filter(space => {
        const bindings = (space as { bindings?: Array<{ kind: string; id: string }> })?.bindings ?? [];
        return bindings.some(binding => binding.kind === 'project' && allowed.has(binding.id));
      }),
    };
  }
  if ((capabilityId === 'xopc.sessions.list' || capabilityId === 'xopc.sessions.search') && Array.isArray(record.items)) {
    const items = record.items.filter(item => {
      const pid = (item as { projectId?: unknown })?.projectId;
      return typeof pid === 'string' && allowed.has(pid);
    });
    return { ...record, items, ...(typeof record.total === 'number' ? { total: items.length } : {}) };
  }
  if ((capabilityId === 'xopc.knowledge.list' || capabilityId === 'xopc.knowledge.search') && Array.isArray(record.items)) {
    return {
      ...record,
      items: record.items.filter(item => {
        const scope = (item as { scope?: { type?: string; id?: string } })?.scope;
        return scope?.type === 'global' || scope?.type === 'workspace' || (scope?.type === 'project' && Boolean(scope.id && allowed.has(scope.id)));
      }),
    };
  }
  if (capabilityId === 'xopc.workspace.search' && Array.isArray(record.hits)) {
    const tasksRepo = new TaskRepository();
    const objectLinks = new ObjectLinkService();
    return {
      ...record,
      hits: record.hits.filter(hit => {
        const item = hit as { kind?: string; id?: string };
        if (item.kind === 'project') return Boolean(item.id && allowed.has(item.id));
        if (item.kind === 'task') {
          const task = item.id ? tasksRepo.get(item.id) : undefined;
          return Boolean(task?.projectId && allowed.has(task.projectId));
        }
        if (item.kind === 'note') {
          return noteMatchesProjects(item.id, undefined, allowed, objectLinks);
        }
        return true;
      }),
    };
  }
  return result;
}
