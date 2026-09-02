import type { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { ActivityService } from '../../../activity/index.js';
import { resolveEffectiveAgentProfile } from '../../../config/agent-profile.js';
import { ExecutionEnvironmentStore } from '../../../execution-environments/store.js';
import {
  buildProjectLoopOverview,
  inferProjectKind,
  inferProjectExecutionMode,
  inferSuggestedProjectDefaultAgentId,
  isValidProjectAgentId,
  normalizeProjectAgentId,
  ProjectWorkspaceConflictError,
  ProjectWorkspaceMissingError,
  type Project,
  resolveProjectAgentId,
  type ProjectStatus,
  type ProjectExecutionMode,
  type ProjectWorkflowRunBrief,
} from '../../../projects/index.js';
import {
  TaskApplicationService,
  defineTaskContract,
  ProjectOperatingViewService,
  summarizeProjectOperatingView,
  TaskReadModelProjector,
  TaskRepository,
} from '../../../tasks/index.js';
import {
  getSqliteDatabase,
  getSessionMetadata,
  listMemoryRecords,
  loadTranscriptRowsForSession,
  upsertMemoryRecord,
} from '../../../storage/sqlite/index.js';
import { createGatewayRouteLogger } from '../lib/route-logger.js';
import { classifyFileReferenceFsError } from '../../file-reference-errors.js';
import { parseActivityIncludeRelated, parseActivityQuery } from './activity.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { FILE_SEARCH_MAX_LIMIT, fuzzySearchWorkspaceFiles } from '../../workspace-file-search.js';

const log = createGatewayRouteLogger('Projects');

function parseProjectStatus(raw: unknown): ProjectStatus | undefined {
  return raw === 'planned' || raw === 'active' || raw === 'paused'
    || raw === 'completed' || raw === 'cancelled' || raw === 'archived'
    ? raw
    : undefined;
}

function parseProjectExecutionMode(raw: unknown): ProjectExecutionMode | undefined {
  return raw === 'local_checkout' || raw === 'managed_worktree' ? raw : undefined;
}

function parseLimit(raw: string | undefined, fallback = 50): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(500, Math.max(1, n)) : fallback;
}

function isHiddenEmptyProjectChatShell(session: {
  hiddenFromSessionList?: boolean;
  messageCount?: number;
  routing?: { peerId?: string };
  customData?: Record<string, unknown>;
}): boolean {
  return session.hiddenFromSessionList === true
    && session.messageCount === 0
    && session.customData?.genericNewChatShell !== false
    && Boolean(session.routing?.peerId?.startsWith('chat_'));
}

function textField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' ? value : undefined;
}

function optionalTextField(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  return typeof value === 'string' ? value : null;
}

function stringListField(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${key} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function objectField(body: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${key} must be an object`);
  return value as Record<string, unknown>;
}

function optionalNumberField(body: Record<string, unknown>, key: string): number | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
  return value;
}

function projectHealth(value: unknown): 'unknown' | 'on_track' | 'at_risk' | 'off_track' | undefined {
  return value === 'unknown' || value === 'on_track' || value === 'at_risk' || value === 'off_track'
    ? value
    : undefined;
}

function milestoneStatus(value: unknown): 'planned' | 'active' | 'completed' | 'cancelled' | undefined {
  return value === 'planned' || value === 'active' || value === 'completed' || value === 'cancelled'
    ? value
    : undefined;
}

function resolveEffectiveWorkspaceRoot(
  service: AuthenticatedRouteDeps['service'],
  project: Project,
): string | undefined {
  const fixedRoot = project.workspaceRoot?.trim();
  if (fixedRoot) return fixedRoot;
  const agentId = resolveProjectAgentId({
    config: service.currentConfig,
    projects: service.projects,
    projectId: project.id,
  });
  return resolveEffectiveAgentProfile(service.currentConfig, agentId).resolvedWorkspacePath;
}

function enrichProjectWorkspace<T extends Project>(
  service: AuthenticatedRouteDeps['service'],
  project: T,
): T {
  return {
    ...project,
    workspaceMode: project.workspaceRoot?.trim() ? 'fixed' : 'followAgent',
    effectiveWorkspaceRoot: resolveEffectiveWorkspaceRoot(service, project),
  };
}


const SKIP_FILE_NAMES = new Set(['.git', 'node_modules']);

const PROJECT_FILE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/typescript',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  webm: 'video/webm',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

function normalizeRelativePath(raw: string | undefined): string {
  const normalized = (raw ?? '').trim().replaceAll('\\', '/');
  return normalized.replace(/^\/+/, '');
}

function isWithinDirectory(root: string, target: string): boolean {
  const relativePath = path.relative(root, target);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

async function resolveProjectWorkspaceRoot(
  service: AuthenticatedRouteDeps['service'],
  projectId: string,
): Promise<{ ok: true; projectId: string; root: string } | { ok: false; status: number; error: string }> {
  const project = service.projects.get(projectId);
  if (!project) return { ok: false, status: 404, error: 'Project not found' };
  const workspaceRoot = resolveEffectiveWorkspaceRoot(service, project);
  if (!workspaceRoot?.trim()) {
    return { ok: false, status: 400, error: 'Project workspace root is not set' };
  }

  try {
    const root = await realpath(workspaceRoot);
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) {
      return { ok: false, status: 400, error: 'Project workspace root is not a directory' };
    }
    return { ok: true, projectId: project.id, root };
  } catch (err) {
    log.warn({ err, projectId: project.id, path: workspaceRoot }, 'project workspace root unavailable');
    return { ok: false, status: 404, error: 'Project workspace root is unavailable' };
  }
}

async function resolveProjectWorkspacePath(
  service: AuthenticatedRouteDeps['service'],
  projectId: string,
  rawPath: string | undefined,
): Promise<
  | { ok: true; projectId: string; root: string; requestedPath: string; absolutePath: string; relativePath: string }
  | { ok: false; status: number; error: string }
> {
  const rootResult = await resolveProjectWorkspaceRoot(service, projectId);
  if (rootResult.ok === false) {
    return { ok: false, status: rootResult.status, error: rootResult.error };
  }

  const requestedPath = normalizeRelativePath(rawPath);
  const candidate = path.resolve(rootResult.root, requestedPath);
  if (!isWithinDirectory(rootResult.root, candidate)) {
    return { ok: false, status: 400, error: 'Path is outside project workspace' };
  }

  const relativePath = path.relative(rootResult.root, candidate).split(path.sep).join('/');
  return {
    ok: true,
    projectId: rootResult.projectId,
    root: rootResult.root,
    requestedPath,
    absolutePath: candidate,
    relativePath: relativePath === '.' ? '' : relativePath,
  };
}

async function resolveExistingProjectWorkspacePath(
  service: AuthenticatedRouteDeps['service'],
  projectId: string,
  rawPath: string | undefined,
): Promise<
  | {
      ok: true;
      projectId: string;
      root: string;
      requestedPath: string;
      absolutePath: string;
      relativePath: string;
      stat: Awaited<ReturnType<typeof stat>>;
    }
  | { ok: false; status: number; error: string }
> {
  const resolved = await resolveProjectWorkspacePath(service, projectId, rawPath);
  if (resolved.ok === false) return resolved;
  if (!resolved.requestedPath.trim()) {
    return { ok: false, status: 400, error: 'Missing path' };
  }

  let realTarget: string;
  try {
    realTarget = await realpath(resolved.absolutePath);
  } catch {
    return { ok: false, status: 404, error: 'Not found' };
  }
  if (!isWithinDirectory(resolved.root, realTarget)) {
    return { ok: false, status: 400, error: 'Path is outside project workspace' };
  }
  const targetStat = await stat(realTarget);
  return {
    ...resolved,
    absolutePath: realTarget,
    stat: targetStat,
  };
}

async function resolveProjectWorkspaceWritePath(
  service: AuthenticatedRouteDeps['service'],
  projectId: string,
  rawPath: string | undefined,
): Promise<
  | {
      ok: true;
      projectId: string;
      root: string;
      requestedPath: string;
      absolutePath: string;
      relativePath: string;
      existingStat?: Awaited<ReturnType<typeof stat>>;
    }
  | { ok: false; status: number; error: string }
> {
  const resolved = await resolveProjectWorkspacePath(service, projectId, rawPath);
  if (resolved.ok === false) return resolved;
  if (!resolved.requestedPath.trim()) {
    return { ok: false, status: 400, error: 'Missing path' };
  }

  try {
    const realTarget = await realpath(resolved.absolutePath);
    if (!isWithinDirectory(resolved.root, realTarget)) {
      return { ok: false, status: 400, error: 'Path is outside project workspace' };
    }
    return {
      ...resolved,
      absolutePath: realTarget,
      existingStat: await stat(realTarget),
    };
  } catch {
    const parentPath = path.dirname(resolved.absolutePath);
    try {
      const realParent = await realpath(parentPath);
      if (!isWithinDirectory(resolved.root, realParent)) {
        return { ok: false, status: 400, error: 'Path is outside project workspace' };
      }
    } catch {
      return { ok: false, status: 404, error: 'Parent directory not found' };
    }
    return resolved;
  }
}

function textFromTranscriptContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const record = part as Record<string, unknown>;
      return typeof record.text === 'string' ? record.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

function buildSessionSummaryMemoryContent(sessionKey: string, explicitSummary?: string): string {
  const summary = explicitSummary?.trim();
  if (summary) return summary;
  const rows = loadTranscriptRowsForSession(sessionKey)
    .filter((row) => {
      if (!row || typeof row !== 'object') return false;
      const record = row as unknown as Record<string, unknown>;
      const role = record.role;
      return role === 'user' || role === 'assistant' || role === 'compactionSummary' || role === 'branchSummary';
    })
    .slice(-12);
  const lines = rows
    .map((row) => {
      const record = row as unknown as Record<string, unknown>;
      const rowRole = typeof record.role === 'string' ? record.role : 'message';
      const role = rowRole === 'compactionSummary' || rowRole === 'branchSummary' ? 'summary' : rowRole;
      const text = (typeof record.summary === 'string' ? record.summary : undefined) ?? textFromTranscriptContent(record.content);
      const compact = text.trim().replace(/\s+/g, ' ').slice(0, 280);
      return compact ? `- ${role}: ${compact}` : '';
    })
    .filter(Boolean);
  return lines.length > 0
    ? [`Session summary for ${sessionKey}:`, ...lines].join('\n')
    : `Session summary for ${sessionKey}: no transcript content available.`;
}


function listFailedProjectWorkflowRuns(projectId: string, limit = 5): ProjectWorkflowRunBrief[] {
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT run_id, definition_id, status, created_at_ms, error_message
       FROM workflow_runs
       WHERE project_id = ? AND status IN ('failed', 'timeout', 'cancelled')
       ORDER BY created_at_ms DESC
       LIMIT ?`,
    )
    .all(projectId, Math.max(1, Math.min(20, Math.floor(limit)))) as Array<{
      run_id: string;
      definition_id: string;
      status: string;
      created_at_ms: number;
      error_message: string | null;
    }>;
  return rows.map((row) => ({
    runId: row.run_id,
    definitionId: row.definition_id,
    status: row.status,
    createdAt: row.created_at_ms,
    errorMessage: row.error_message ?? undefined,
  }));
}

function buildProjectDigestMemoryContent(input: ReturnType<typeof buildProjectLoopOverview> & { projectName: string }): string {
  const lines = [
    `Project digest: ${input.projectName}`,
    `Status: ${input.digest.summary}`,
    input.digest.nextAction ? `Next: ${input.digest.nextAction}` : undefined,
  ].filter(Boolean) as string[];
  if (input.attentionItems.length > 0) {
    lines.push('', 'Attention:');
    for (const item of input.attentionItems.slice(0, 8)) {
      lines.push(`- ${item.kind}: ${item.title}${item.detail ? ` - ${item.detail}` : ''}`);
    }
  }
  if (input.timeline.length > 0) {
    lines.push('', 'Recent activity:');
    for (const item of input.timeline.slice(0, 8)) {
      lines.push(`- ${item.kind}: ${item.title}${item.detail ? ` - ${item.detail}` : ''}`);
    }
  }
  return lines.join('\n');
}

function projectDigestMemoryRecordId(projectId: string): string {
  return `project-digest:${projectId}`;
}

export function registerProjectsRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;
  const activity = new ActivityService();
  const operatingViews = new ProjectOperatingViewService(service.projects);
  const environments = new ExecutionEnvironmentStore();

  authenticated.post('/api/projects', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = textField(body, 'name')?.trim();
    const workspaceRoot = textField(body, 'workspaceRoot')?.trim();
    if (!name && !workspaceRoot) return c.json({ ok: false, error: 'Missing name' }, 400);
    const executionMode = parseProjectExecutionMode(body.executionMode);
    if (body.executionMode !== undefined && !executionMode) {
      return c.json({ ok: false, error: 'Invalid project execution mode' }, 400);
    }
    const hasDefaultAgentPatch = Object.hasOwn(body, 'defaultAgentId');
    const explicitDefaultAgentId = normalizeProjectAgentId(textField(body, 'defaultAgentId'));
    const defaultAgentId = hasDefaultAgentPatch
      ? explicitDefaultAgentId
      : inferSuggestedProjectDefaultAgentId({
        config: service.currentConfig,
        name,
        description: textField(body, 'description'),
        workspaceRoot,
        projectKind: textField(body, 'projectKind'),
      });
    if (!isValidProjectAgentId(service.currentConfig, defaultAgentId)) {
      return c.json({ ok: false, error: 'Default agent not found' }, 400);
    }
    try {
      const project = service.projects.create({
        name,
        description: textField(body, 'description'),
        defaultAgentId,
        workspaceRoot,
        createWorkspaceRoot: body.createWorkspaceRoot === true,
        projectKind: textField(body, 'projectKind'),
        executionMode,
        brief: textField(body, 'brief'),
        instructions: textField(body, 'instructions'),
        outcome: textField(body, 'outcome'),
        successCriteria: stringListField(body, 'successCriteria'),
        scope: objectField(body, 'scope'),
        nonGoals: stringListField(body, 'nonGoals'),
        health: projectHealth(body.health),
        ownerId: textField(body, 'ownerId'),
        targetAt: optionalNumberField(body, 'targetAt') ?? undefined,
      });
      return c.json({ ok: true, project: enrichProjectWorkspace(service, project) }, 201);
    } catch (error) {
      if (error instanceof ProjectWorkspaceConflictError) {
        return c.json({ ok: false, code: 'workspace_already_bound', error: error.message, project: error.project }, 409);
      }
      if (error instanceof ProjectWorkspaceMissingError) {
        return c.json({ ok: false, code: 'workspace_root_missing', error: error.message, workspaceRoot: error.workspaceRoot }, 409);
      }
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.get('/api/projects', async (c) => {
    const status = parseProjectStatus(c.req.query('status'));
    const result = service.projects.list({
      ...(status ? { status } : {}),
      search: c.req.query('search'),
      sortBy: c.req.query('sortBy') as 'updatedAt' | 'createdAt' | 'name' | undefined,
      sortOrder: c.req.query('sortOrder') as 'asc' | 'desc' | undefined,
      limit: parseLimit(c.req.query('limit')),
      offset: c.req.query('offset') ? Math.max(0, Number.parseInt(c.req.query('offset')!, 10) || 0) : undefined,
    });
    const includeOperating = c.req.query('includeOperating') === 'true';
    return c.json({
      ok: true,
      ...result,
      items: result.items.map((project) => {
        const enriched = enrichProjectWorkspace(service, project);
        if (!includeOperating) return enriched;
        const view = operatingViews.get(project.id);
        return { ...enriched, operating: view ? summarizeProjectOperatingView(view) : undefined };
      }),
    });
  });

  authenticated.get('/api/projects/suggestions', async (c) => {
    const sessionKey = c.req.query('sessionKey')?.trim();
    return c.json({ ok: true, suggestions: sessionKey ? service.projects.suggestProjectsForSession(sessionKey) : [] });
  });

  authenticated.post('/api/projects/infer-defaults', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const input = {
      name: textField(body, 'name'),
      description: textField(body, 'description'),
      workspaceRoot: textField(body, 'workspaceRoot'),
      projectKind: textField(body, 'projectKind'),
    };
    const inference = inferProjectKind(input);
    const defaultAgentId = inferSuggestedProjectDefaultAgentId({
      config: service.currentConfig,
      ...input,
    });
    const executionMode = inferProjectExecutionMode(input);
    return c.json({ ok: true, inference, defaultAgentId, executionMode });
  });

  authenticated.post('/api/projects/resolve-workspace', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const workspacePath = textField(body, 'workspacePath')?.trim();
    if (!workspacePath) return c.json({ ok: false, error: 'Missing workspacePath' }, 400);
    const agentId = textField(body, 'agentId')?.trim() || 'main';
    const suggestedDefaultAgentId = inferSuggestedProjectDefaultAgentId({
      config: service.currentConfig,
      workspaceRoot: workspacePath,
      projectKind: textField(body, 'projectKind'),
    });
    let match;
    try {
      match = service.projects.resolveOrCreateForWorkspacePath({
        workspacePath,
        agentId,
        defaultAgentId: suggestedDefaultAgentId,
        autoCreate: body.autoCreate !== false,
      });
    } catch (error) {
      if (error instanceof ProjectWorkspaceConflictError) {
        match = { project: error.project, reason: 'exact' as const, created: false };
      } else {
        throw error;
      }
    }
    if (!match) return c.json({ ok: true, project: null });

    const sessionKey = textField(body, 'sessionKey')?.trim();
    const projectDefaultAgentId = normalizeProjectAgentId(match.project.defaultAgentId);
    const shouldBindRequestedSession = !projectDefaultAgentId || projectDefaultAgentId === normalizeProjectAgentId(agentId);
    if (sessionKey && shouldBindRequestedSession) {
      const existingSession = getSessionMetadata(sessionKey);
      if (!existingSession) {
        await service.sessionIndexInstance.saveMessages(sessionKey, [], {
          metadata: {
            sourceChannel: 'tui',
            sourceChatId: `default:direct:${sessionKey}`,
            sessionType: 'chat',
            projectId: match.project.id,
            routing: {
              agentId,
              source: 'tui',
              accountId: 'default',
              peerKind: 'direct',
              peerId: sessionKey,
            },
          },
        });
      }
      service.projects.attachSession(sessionKey, match.project.id);
    }

    return c.json({ ok: true, ...match });
  });

  authenticated.get('/api/projects/:id/activity', (c) => {
    const project = service.projects.get(c.req.param('id'));
    if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);
    const result = activity.listForProject({
      projectId: project.id,
      includeRelated: parseActivityIncludeRelated(c.req.query('includeRelated')),
      ...parseActivityQuery(c),
    });
    return c.json({ ok: true, ...result });
  });

 authenticated.post('/api/projects/:id/digest-memory', async (c) => {
    const project = service.projects.getWithDetails(c.req.param('id'));
    if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);
    const projectTasks = new TaskRepository().listByProject(project.id, 100)
      .map((task) => {
        const model = new TaskReadModelProjector().project(task);
        return {
          id: task.id,
          title: task.title,
          phase: task.phase,
          operationalState: model.operationalState,
          attention: model.attention.map((item) => item.summary),
          priority: task.priority,
          updatedAt: task.updatedAt,
        };
      });
    const loop = buildProjectLoopOverview({
      project,
      tasks: projectTasks,
      recentWorkflowRuns: project.recentWorkflowRuns,
      failedWorkflowRuns: listFailedProjectWorkflowRuns(project.id),
      memoryRecords: listMemoryRecords({ projectId: project.id, status: 'active', limit: 5 }),
    });
    const record = upsertMemoryRecord({
      id: projectDigestMemoryRecordId(project.id),
      providerId: 'local',
      kind: 'daily_note',
      sourceAgentId: resolveProjectAgentId({
        config: service.currentConfig,
        projects: service.projects,
        projectId: project.id,
      }),
      workspaceId: project.workspaceRoot,
      projectId: project.id,
      content: buildProjectDigestMemoryContent({ ...loop, projectName: project.name }),
      source: {
        provider: 'project-digest',
      },
      confidence: 0.75,
      tags: ['project', 'project-digest', project.slug],
      status: 'active',
      sensitivity: 'normal',
    });
    return c.json({ ok: true, record }, 201);
  });

  authenticated.post('/api/projects/:id/blockers', async (c) => {
    const project = service.projects.getWithDetails(c.req.param('id'));
    if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return c.json({ ok: false, error: 'Missing title' }, 400);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const agentId = resolveProjectAgentId({
        config: service.currentConfig,
        projects: service.projects,
        projectId: project.id,
    });
    const contract = defineTaskContract(title);
    const created = new TaskApplicationService().create({
      idempotencyKey: randomUUID(), title, projectId: project.id, delegateAgentId: agentId,
      priority: body.priority === 'low' || body.priority === 'normal' || body.priority === 'high' ? body.priority : 'high',
      contract: { ...contract, acceptancePolicy: 'manual', outputDestinations: [] },
      dependencies: [], context: [], authorityGrants: [], activation: { mode: 'capture', phase: 'ready' },
    });
    if (created.ok === false) return c.json({ ok: false, error: created.reason }, 409);
    const blocked = new TaskApplicationService().execute({
      taskId: created.model.task.id, expectedVersion: created.model.task.version,
      idempotencyKey: randomUUID(),
      command: { type: 'add_wait', wait: { kind: 'paused', reason: reason || title, condition: {} } },
    });
    return c.json({ ok: true, blocker: blocked.ok ? blocked.model : created.model }, 201);
  });

  authenticated.post('/api/projects/:id/pin', async (c) => {
    try {
      const project = service.projects.pin(c.req.param('id'));
      return c.json({ ok: true, project: enrichProjectWorkspace(service, project) });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 404);
    }
  });

  authenticated.post('/api/projects/:id/unpin', async (c) => {
    try {
      const project = service.projects.unpin(c.req.param('id'));
      return c.json({ ok: true, project: enrichProjectWorkspace(service, project) });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 404);
    }
  });

  authenticated.get('/api/projects/:id', async (c) => {
    const project = service.projects.getWithDetails(c.req.param('id'));
    if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);
    return c.json({ ok: true, project: enrichProjectWorkspace(service, project) });
  });

  authenticated.get('/api/projects/:id/milestones', (c) => {
    const project = service.projects.get(c.req.param('id'));
    if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);
    return c.json({ ok: true, items: service.projects.listMilestones(project.id) });
  });

  authenticated.post('/api/projects/:id/milestones', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = textField(body, 'title')?.trim();
    if (!title) return c.json({ ok: false, error: 'Missing title' }, 400);
    if (body.status !== undefined && !milestoneStatus(body.status)) {
      return c.json({ ok: false, error: 'Invalid milestone status' }, 400);
    }
    try {
      const milestone = service.projects.createMilestone(c.req.param('id'), {
        title,
        description: textField(body, 'description'),
        status: milestoneStatus(body.status),
        targetAt: optionalNumberField(body, 'targetAt') ?? undefined,
        sortOrder: optionalNumberField(body, 'sortOrder') ?? undefined,
      });
      return c.json({ ok: true, milestone }, 201);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.patch('/api/projects/:id/milestones/:milestoneId', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.status !== undefined && !milestoneStatus(body.status)) {
      return c.json({ ok: false, error: 'Invalid milestone status' }, 400);
    }
    try {
      const milestone = service.projects.updateMilestone(c.req.param('id'), c.req.param('milestoneId'), {
        ...(textField(body, 'title') !== undefined ? { title: textField(body, 'title')! } : {}),
        ...(optionalTextField(body, 'description') !== undefined ? { description: optionalTextField(body, 'description') } : {}),
        ...(body.status !== undefined ? { status: milestoneStatus(body.status)! } : {}),
        ...(body.targetAt !== undefined ? { targetAt: optionalNumberField(body, 'targetAt') } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: optionalNumberField(body, 'sortOrder')! } : {}),
      });
      return c.json({ ok: true, milestone });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 404);
    }
  });

  authenticated.delete('/api/projects/:id/milestones/:milestoneId', (c) => {
    const deleted = service.projects.deleteMilestone(c.req.param('id'), c.req.param('milestoneId'));
    return deleted ? c.json({ ok: true }) : c.json({ ok: false, error: 'Milestone not found' }, 404);
  });

  authenticated.get('/api/projects/:id/updates', (c) => {
    const project = service.projects.get(c.req.param('id'));
    if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);
    return c.json({ ok: true, items: service.projects.listUpdates(project.id, parseLimit(c.req.query('limit'), 20)) });
  });

  authenticated.post('/api/projects/:id/updates', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const summary = textField(body, 'summary')?.trim();
    const health = projectHealth(body.health);
    if (!summary || !health) return c.json({ ok: false, error: 'Missing summary or valid health' }, 400);
    try {
      const update = service.projects.createUpdate(c.req.param('id'), {
        health,
        summary,
        progress: stringListField(body, 'progress'),
        risks: stringListField(body, 'risks'),
        nextSteps: stringListField(body, 'nextSteps'),
        actor: objectField(body, 'actor') ?? { kind: 'user' },
      });
      return c.json({ ok: true, update }, 201);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.patch('/api/projects/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const projectId = c.req.param('id');
    const status = parseProjectStatus(body.status);
    const defaultAgentPatch = optionalTextField(body, 'defaultAgentId');
    const defaultAgentId = defaultAgentPatch === undefined ? undefined : normalizeProjectAgentId(defaultAgentPatch);
    if (body.status !== undefined && !status) return c.json({ ok: false, error: 'Invalid project status' }, 400);
    if (body.health !== undefined && !projectHealth(body.health)) return c.json({ ok: false, error: 'Invalid project health' }, 400);
    const executionMode = parseProjectExecutionMode(body.executionMode);
    if (body.executionMode !== undefined && !executionMode) {
      return c.json({ ok: false, error: 'Invalid project execution mode' }, 400);
    }
    if (defaultAgentId && !isValidProjectAgentId(service.currentConfig, defaultAgentId)) {
      return c.json({ ok: false, error: 'Default agent not found' }, 400);
    }
    const currentProject = service.projects.get(projectId);
    const requestedWorkspaceRoot = optionalTextField(body, 'workspaceRoot');
    if (
      currentProject
      && requestedWorkspaceRoot !== undefined
      && requestedWorkspaceRoot !== (currentProject.workspaceRoot ?? null)
      && environments.list({ projectId, limit: 1 }).length > 0
    ) {
      return c.json({
        ok: false,
        code: 'execution_environments_exist',
        error: 'Delete the project execution environments before changing its workspace',
      }, 409);
    }
    try {
      const project = service.projects.update(projectId, {
        ...(textField(body, 'name') !== undefined ? { name: textField(body, 'name') } : {}),
        ...(optionalTextField(body, 'description') !== undefined ? { description: optionalTextField(body, 'description') } : {}),
        ...(status ? { status } : {}),
        ...(defaultAgentPatch !== undefined ? { defaultAgentId: defaultAgentId ?? null } : {}),
        ...(optionalTextField(body, 'workspaceRoot') !== undefined ? { workspaceRoot: optionalTextField(body, 'workspaceRoot') } : {}),
        createWorkspaceRoot: body.createWorkspaceRoot === true,
        ...(executionMode ? { executionMode } : {}),
        ...(optionalTextField(body, 'brief') !== undefined ? { brief: optionalTextField(body, 'brief') } : {}),
        ...(optionalTextField(body, 'instructions') !== undefined ? { instructions: optionalTextField(body, 'instructions') } : {}),
        ...(optionalTextField(body, 'outcome') !== undefined ? { outcome: optionalTextField(body, 'outcome') } : {}),
        ...(body.successCriteria !== undefined ? { successCriteria: stringListField(body, 'successCriteria')! } : {}),
        ...(body.scope !== undefined ? { scope: objectField(body, 'scope')! } : {}),
        ...(body.nonGoals !== undefined ? { nonGoals: stringListField(body, 'nonGoals')! } : {}),
        ...(body.health !== undefined ? { health: projectHealth(body.health)! } : {}),
        ...(optionalTextField(body, 'ownerId') !== undefined ? { ownerId: optionalTextField(body, 'ownerId') } : {}),
        ...(body.targetAt !== undefined ? { targetAt: optionalNumberField(body, 'targetAt') } : {}),
      });
      return c.json({ ok: true, project: enrichProjectWorkspace(service, project) });
    } catch (error) {
      if (error instanceof ProjectWorkspaceConflictError) {
        return c.json({ ok: false, code: 'workspace_already_bound', error: error.message, project: error.project }, 409);
      }
      if (error instanceof ProjectWorkspaceMissingError) {
        return c.json({ ok: false, code: 'workspace_root_missing', error: error.message, workspaceRoot: error.workspaceRoot }, 409);
      }
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 404);
    }
  });

  authenticated.delete('/api/projects/:id', async (c) => {
    const projectId = c.req.param('id');
    if (environments.list({ projectId, limit: 1 }).length > 0) {
      return c.json({
        ok: false,
        code: 'execution_environments_exist',
        error: 'Delete the project execution environments before deleting the project',
      }, 409);
    }
    service.projects.delete(projectId);
    return c.json({ ok: true });
  });

  authenticated.get('/api/projects/:id/sessions', async (c) => {
    try {
      const keys = service.projects.listSessionKeys(c.req.param('id'), parseLimit(c.req.query('limit'), 100));
      const sessions = await Promise.all(keys.map((key) => service.sessions.getSession(key)));
      return c.json({
        ok: true,
        sessions: sessions.filter((session) => session && !isHiddenEmptyProjectChatShell(session)),
      });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 404);
    }
  });

  authenticated.get('/api/projects/:id/files', async (c) => {
    const resolved = await resolveProjectWorkspacePath(service, c.req.param('id'), c.req.query('path'));
    if (resolved.ok === false) return c.json({ ok: false, error: resolved.error }, resolved.status as 400);
    const { root, absolutePath: candidate } = resolved;
    let currentPath: string;
    try {
      currentPath = await realpath(candidate);
      if (!isWithinDirectory(root, currentPath)) {
        return c.json({ ok: false, error: 'Path is outside project workspace' }, 400);
      }
      const currentStat = await stat(currentPath);
      if (!currentStat.isDirectory()) {
        return c.json({ ok: false, error: 'Path is not a directory' }, 400);
      }
    } catch (err) {
      log.warn({ err, projectId: resolved.projectId, path: candidate }, 'project file path unavailable');
      return c.json({ ok: false, error: 'Path not found' }, 404);
    }

    try {
      const dirents = await readdir(currentPath, { withFileTypes: true });
      const entries = await Promise.all(dirents
        .filter((entry) => !SKIP_FILE_NAMES.has(entry.name))
        .map(async (entry) => {
          const displayPath = path.join(currentPath, entry.name);
          const absolutePath = await realpath(displayPath).catch(() => null);
          if (!absolutePath || !isWithinDirectory(root, absolutePath)) return null;
          const entryStat = await stat(absolutePath).catch(() => null);
          if (!entryStat) return null;
          const relativePath = path.relative(root, displayPath).split(path.sep).join('/');
          return {
            name: entry.name,
            path: relativePath,
            absolutePath,
            type: entryStat.isDirectory() ? 'directory' : 'file',
            size: entryStat?.isFile() ? entryStat.size : undefined,
            updatedAt: entryStat?.mtime.toISOString(),
          };
        }));
      const visibleEntries = entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      visibleEntries.sort((left, right) => {
        if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
        return left.name.localeCompare(right.name);
      });
      const relativeCurrentPath = path.relative(root, currentPath).split(path.sep).join('/');
      const parentRelativePath = relativeCurrentPath ? path.dirname(relativeCurrentPath).replaceAll('\\', '/') : null;
      return c.json({
        ok: true,
        root,
        path: relativeCurrentPath === '.' ? '' : relativeCurrentPath,
        parentPath: parentRelativePath === '.' ? '' : parentRelativePath,
        entries: visibleEntries,
      });
    } catch (err) {
      log.warn({ err, projectId: resolved.projectId, path: currentPath }, 'project file list failed');
      if ((err as NodeJS.ErrnoException)?.code === 'EACCES') {
        return c.json({ ok: false, error: 'Permission denied' }, 403);
      }
      return c.json({ ok: false, error: 'Failed to read project files' }, 500);
    }
  });

  /** Fuzzy filename / path search across the entire project workspace. */
  authenticated.get('/api/projects/:id/files/search', async (c) => {
    const q = typeof c.req.query('q') === 'string' ? c.req.query('q')!.trim() : '';
    const limitRaw = c.req.query('limit');
    const limit = Math.min(
      Math.max(parseInt(typeof limitRaw === 'string' ? limitRaw : '50', 10) || 50, 1),
      FILE_SEARCH_MAX_LIMIT,
    );
    const root = await resolveProjectWorkspaceRoot(service, c.req.param('id'));
    if (root.ok === false) return c.json({ ok: false, error: root.error }, root.status as 400);
    const entries = await fuzzySearchWorkspaceFiles(root.root, q, limit);
    return c.json({ ok: true, entries });
  });

  authenticated.get('/api/projects/:id/files/read', async (c) => {
    const resolved = await resolveExistingProjectWorkspacePath(service, c.req.param('id'), c.req.query('path'));
    if (resolved.ok === false) return c.json({ ok: false, error: { message: resolved.error } }, resolved.status as 400);
    if (!resolved.stat.isFile()) {
      return c.json({ ok: false, error: { message: 'Not a file' } }, 400);
    }
    try {
      const content = await readFile(resolved.absolutePath, 'utf-8');
      return c.json({
        ok: true,
        payload: {
          content,
          path: resolved.relativePath,
          absolutePath: resolved.absolutePath,
          mtimeMs: resolved.stat.mtimeMs,
        },
      });
    } catch {
      return c.json({ ok: false, error: { message: 'Read failed' } }, 500);
    }
  });

  authenticated.get('/api/projects/:id/files/raw', async (c) => {
    const resolved = await resolveExistingProjectWorkspacePath(service, c.req.param('id'), c.req.query('path'));
    if (resolved.ok === false) return c.json({ ok: false, error: { message: resolved.error } }, resolved.status as 400);
    if (!resolved.stat.isFile()) {
      return c.json({ ok: false, error: { message: 'Not a file' } }, 400);
    }
    const ext = resolved.relativePath.split('.').pop()?.toLowerCase() ?? '';
    const contentType = PROJECT_FILE_MIME_BY_EXT[ext] || 'application/octet-stream';
    try {
      const buf = await readFile(resolved.absolutePath);
      return new Response(buf, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } catch {
      return c.json({ ok: false, error: { message: 'Read failed' } }, 500);
    }
  });

  authenticated.get('/api/projects/:id/files/resolve-reference', async (c) => {
    const rawPath = typeof c.req.query('path') === 'string' ? c.req.query('path')!.trim() : '';
    if (!rawPath) {
      return c.json({ ok: false, error: { code: 'INVALID_PATH', message: 'Missing path' } }, 400);
    }
    const resolved = await resolveProjectWorkspacePath(service, c.req.param('id'), rawPath);
    if (resolved.ok === false) {
      return c.json({ ok: false, error: { code: 'PROJECT_WORKSPACE_RESOLUTION_FAILED', message: resolved.error } }, resolved.status as 400);
    }
    let st: Awaited<ReturnType<typeof stat>> | null = null;
    let statError: unknown = null;
    let absolutePath = resolved.absolutePath;
    try {
      absolutePath = await realpath(resolved.absolutePath);
      if (!isWithinDirectory(resolved.root, absolutePath)) {
        return c.json({
          ok: false,
          error: { code: 'PROJECT_WORKSPACE_RESOLUTION_FAILED', message: 'Path is outside project workspace' },
        }, 400);
      }
      st = await stat(absolutePath);
    } catch (err) {
      statError = err;
    }
    const displayName = path.basename(rawPath);
    if (!st) {
      const failure = classifyFileReferenceFsError(statError);
      if (failure.code !== 'FILE_NOT_FOUND') {
        log.warn(
          { err: statError, projectId: resolved.projectId, workspaceRoot: resolved.root, candidate: resolved.absolutePath, errorCode: failure.code },
          `Project file reference access failed: ${failure.message}`,
        );
        return c.json(
          { ok: false, error: { code: failure.code, message: failure.message } },
          failure.status === 403 ? 403 : 500,
        );
      }
      return c.json({
        ok: true,
        payload: {
          inputPath: rawPath,
          displayName,
          scope: 'missing',
          exists: false,
          absolutePath: resolved.absolutePath,
          capabilities: ['copyPath'],
          errorCode: 'FILE_NOT_FOUND',
        },
      });
    }
    return c.json({
      ok: true,
      payload: {
        inputPath: rawPath,
        displayName,
        scope: 'workspace',
        exists: true,
        isDirectory: st.isDirectory(),
        absolutePath,
        workspaceRelativePath: resolved.relativePath,
        capabilities: st.isDirectory()
          ? ['openExternal', 'revealInFolder', 'copyPath']
          : ['preview', 'edit', 'openExternal', 'revealInFolder', 'copyPath'],
        mtimeMs: st.mtimeMs,
      },
    });
  });

  authenticated.put('/api/projects/:id/files/write', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const bodyRecord = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
    const pathRel = typeof bodyRecord.path === 'string' ? bodyRecord.path : '';
    const content = typeof bodyRecord.content === 'string' ? bodyRecord.content : '';
    if (!pathRel.trim()) {
      return c.json({ ok: false, error: { message: 'Missing path' } }, 400);
    }
    const resolved = await resolveProjectWorkspaceWritePath(service, c.req.param('id'), pathRel);
    if (resolved.ok === false) return c.json({ ok: false, error: { message: resolved.error } }, resolved.status as 400);
    if (resolved.existingStat && !resolved.existingStat.isFile()) {
      return c.json({ ok: false, error: { message: 'Not a file' } }, 400);
    }
    try {
      await writeFile(resolved.absolutePath, content, 'utf-8');
      const mtimeMs = (await stat(resolved.absolutePath).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs;
      return c.json({
        ok: true,
        payload: { path: resolved.relativePath, mtimeMs },
      });
    } catch (err) {
      log.error({ err, projectId: resolved.projectId, path: resolved.absolutePath }, 'project file write failed');
      return c.json({ ok: false, error: { message: 'Write failed' } }, 500);
    }
  });

  authenticated.post('/api/projects/:id/files/upload', async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody();
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid multipart body' } }, 400);
    }
    const file = body.file;
    if (!(file instanceof File)) {
      return c.json({ ok: false, error: { message: 'Missing file' } }, 400);
    }
    const requestedPath = typeof body.path === 'string' ? body.path.trim() : '';
    if (!requestedPath) return c.json({ ok: false, error: { message: 'Missing path' } }, 400);
    const resolved = await resolveProjectWorkspaceWritePath(service, c.req.param('id'), requestedPath);
    if (resolved.ok === false) return c.json({ ok: false, error: { message: resolved.error } }, resolved.status as 400);
    if (resolved.existingStat) {
      return c.json({ ok: false, error: { message: 'File already exists' } }, 409);
    }
    try {
      await writeFile(resolved.absolutePath, Buffer.from(await file.arrayBuffer()), { flag: 'wx' });
      const entryStat = await stat(resolved.absolutePath);
      return c.json({
        ok: true,
        entry: {
          name: path.basename(resolved.relativePath),
          path: resolved.relativePath,
          absolutePath: resolved.absolutePath,
          type: 'file',
          size: entryStat.size,
          updatedAt: entryStat.mtime.toISOString(),
        },
      }, 201);
    } catch (err) {
      log.error({ err, projectId: resolved.projectId, path: resolved.absolutePath }, 'project file upload failed');
      return c.json({ ok: false, error: { message: 'Upload failed' } }, 500);
    }
  });

  authenticated.post('/api/projects/:id/sessions/:sessionKey', async (c) => {
    try {
      service.projects.attachSession(c.req.param('sessionKey'), c.req.param('id'));
      const session = await service.sessions.getSession(c.req.param('sessionKey'));
      return c.json({ ok: true, session });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 404);
    }
  });

  authenticated.delete('/api/projects/:id/sessions/:sessionKey', async (c) => {
    try {
      const projectId = c.req.param('id');
      const sessionKey = c.req.param('sessionKey');
      if (!service.projects.get(projectId)) {
        return c.json({ ok: false, error: 'Project not found' }, 404);
      }
      const session = await service.sessions.getSession(sessionKey);
      if (!session) {
        return c.json({ ok: false, error: 'Session not found' }, 404);
      }
      if (session.projectId !== projectId) {
        return c.json({ ok: false, error: 'Session is not attached to this project' }, 409);
      }
      service.projects.detachSession(sessionKey);
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 404);
    }
  });

  authenticated.post('/api/projects/:id/sessions/:sessionKey/summary-memory', async (c) => {
    const projectId = c.req.param('id');
    const sessionKey = c.req.param('sessionKey');
    const project = service.projects.get(projectId);
    if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);
    const session = getSessionMetadata(sessionKey);
    if (!session) return c.json({ ok: false, error: 'Session not found' }, 404);
    if (session.projectId !== projectId) {
      return c.json({ ok: false, error: 'Session is not attached to this project' }, 409);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const content = buildSessionSummaryMemoryContent(
      sessionKey,
      typeof body.summary === 'string' ? body.summary : undefined,
    );
    const record = upsertMemoryRecord({
      providerId: 'local',
      kind: 'session_summary',
      sourceAgentId: session.routing?.agentId ?? 'main',
      workspaceId: session.cwd,
      sessionKey,
      projectId,
      content,
      source: {
        provider: 'project-summary',
        sessionEntryId: sessionKey,
      },
      confidence: typeof body.confidence === 'number' ? body.confidence : 0.7,
      tags: ['project', 'session-summary', project.slug],
      status: 'active',
      sensitivity: 'normal',
      evidence: [{ sessionKey }],
    });
    return c.json({ ok: true, record }, 201);
  });

}
