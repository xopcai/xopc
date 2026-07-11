import type { Hono } from 'hono';
import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { ActivityService } from '../../../activity/index.js';
import { resolveEffectiveAgentProfile } from '../../../config/agent-profile.js';
import type { GoalWithDetails } from '../../../goals/index.js';
import { GoalService } from '../../../goals/index.js';
import {
  buildProjectLoopOverview,
  inferProjectKind,
  inferSuggestedProjectDefaultAgentId,
  isValidProjectAgentId,
  normalizeProjectAgentId,
  ProjectWorkspaceConflictError,
  ProjectWorkspaceMissingError,
  type Project,
  resolveProjectAgentId,
  type ProjectStatus,
  type ProjectWorkflowRunBrief,
} from '../../../projects/index.js';
import { buildSessionKey } from '../../../routing/session-key.js';
import {
  getSqliteDatabase,
  getSessionMetadata,
  listMemoryRecords,
  loadTranscriptRowsForSession,
  type SessionMetadataSeed,
  upsertMemoryRecord,
} from '../../../storage/sqlite/index.js';
import {
  buildWorkItemAgentContext,
  WorkItemService,
  WORK_ITEM_ATTACHMENT_MAX_BYTES,
  WORK_ITEM_ATTACHMENT_MAX_COUNT,
  type WorkItemPriority,
  type WorkItemStatus,
} from '../../../work-items/index.js';
import { createGatewayRouteLogger } from '../lib/route-logger.js';
import { parseActivityIncludeRelated, parseActivityQuery } from './activity.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const log = createGatewayRouteLogger('Projects');

function parseProjectStatus(raw: unknown): ProjectStatus | undefined {
  return raw === 'active' || raw === 'paused' || raw === 'archived' ? raw : undefined;
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

function finiteNumberField(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function collectUploadedFiles(body: Record<string, unknown>): File[] {
  const raw = body.file ?? body.files ?? body.attachments;
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values.filter((value): value is File => value instanceof File);
}

function validateUploadedWorkItemFiles(files: File[]): string | null {
  if (files.length > WORK_ITEM_ATTACHMENT_MAX_COUNT) {
    return `Too many attachments (max ${WORK_ITEM_ATTACHMENT_MAX_COUNT})`;
  }
  for (const file of files) {
    if (file.size > WORK_ITEM_ATTACHMENT_MAX_BYTES) {
      return `Attachment ${JSON.stringify(file.name || 'upload')} exceeds ${Math.floor(WORK_ITEM_ATTACHMENT_MAX_BYTES / (1024 * 1024))}MB limit`;
    }
  }
  return null;
}

async function uploadedFileToBuffer(file: File): Promise<{ name: string; buffer: Buffer; mimeType: string }> {
  return {
    name: file.name || 'upload',
    buffer: Buffer.from(await file.arrayBuffer()),
    mimeType: file.type || 'application/octet-stream',
  };
}

function parseCsvEnum<T extends string>(raw: string | undefined, values: readonly T[]): T[] | undefined {
  if (!raw) return undefined;
  const allowed = new Set(values);
  const parsed = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is T => allowed.has(item as T));
  return parsed.length > 0 ? [...new Set(parsed)] : undefined;
}

function parseEnumValue<T extends string>(raw: unknown, values: readonly T[]): T | undefined {
  if (typeof raw !== 'string') return undefined;
  return values.includes(raw as T) ? raw as T : undefined;
}

const WORK_ITEM_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'needs_input',
  'in_review',
  'done',
  'cancelled',
] as const satisfies readonly WorkItemStatus[];
const WORK_ITEM_PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const satisfies readonly WorkItemPriority[];
const WORK_ITEM_SUGGESTION_STATUSES = ['pending', 'applied', 'dismissed'] as const;

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

function buildWorkItemChatSessionMetadata(params: {
  agentId: string;
  accountId: string;
  peerId: string;
  workItemId: string;
  title: string;
  updatedAt: number;
}): SessionMetadataSeed {
  return {
    name: params.title,
    tags: ['work-item'],
    sourceChannel: 'webchat',
    sourceChatId: [params.accountId, 'direct', params.peerId].join(':'),
    sessionType: 'chat',
    hiddenFromSessionList: true,
    routing: {
      agentId: params.agentId,
      source: 'webchat',
      accountId: params.accountId,
      peerKind: 'direct',
      peerId: params.peerId,
    },
    customData: {
      genericNewChatShell: false,
      sourceBinding: {
        kind: 'work_item',
        sourceId: params.workItemId,
        version: String(params.updatedAt),
        attachedAt: Date.now(),
      },
    },
  };
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
  const goals = new GoalService();
  const workItems = new WorkItemService();

  authenticated.post('/api/projects', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = textField(body, 'name')?.trim();
    const workspaceRoot = textField(body, 'workspaceRoot')?.trim();
    if (!name && !workspaceRoot) return c.json({ ok: false, error: 'Missing name' }, 400);
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
        brief: textField(body, 'brief'),
        instructions: textField(body, 'instructions'),
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
    return c.json({ ok: true, ...result, items: result.items.map((project) => enrichProjectWorkspace(service, project)) });
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
    return c.json({ ok: true, inference, defaultAgentId });
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

  authenticated.get('/api/projects/:id/overview', async (c) => {
    const project = service.projects.getWithDetails(c.req.param('id'));
    if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);
    const goalIds = service.projects.listGoalIds(project.id, parseLimit(c.req.query('goalLimit'), 100));
    const projectGoals = goalIds
      .map((id) => goals.get(id))
      .filter((goal): goal is GoalWithDetails => Boolean(goal));
    const loop = buildProjectLoopOverview({
      project,
      goals: projectGoals,
      recentWorkflowRuns: project.recentWorkflowRuns,
      failedWorkflowRuns: listFailedProjectWorkflowRuns(project.id),
      memoryRecords: listMemoryRecords({ projectId: project.id, status: 'active', limit: 5 }),
    });
    return c.json({
      ok: true,
      overview: {
        project: enrichProjectWorkspace(service, project),
        stats: {
          sessionCount: project.sessionCount,
          goalCount: project.goalCount,
          activeGoalCount: project.activeGoalCount,
          recentWorkflowRunCount: project.recentWorkflowRuns.length,
          staleGoalCount: loop.staleGoals.length,
          attentionCount: loop.attentionItems.length,
          failedWorkflowRunCount: loop.failedWorkflowRuns.length,
        },
        activeGoals: loop.activeGoals,
        blockedGoals: loop.blockedGoals,
        staleGoals: loop.staleGoals,
        nextActions: loop.nextActions,
        attentionItems: loop.attentionItems,
        timeline: loop.timeline,
        digest: loop.digest,
        failedWorkflowRuns: loop.failedWorkflowRuns,
        recentSessions: project.recentSessions,
        recentWorkflowRuns: project.recentWorkflowRuns,
        recommendedAction: loop.recommendedAction,
      },
    });
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

  authenticated.get('/api/projects/:id/work-items', async (c) => {
    const project = service.projects.get(c.req.param('id'));
    if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);
    const result = workItems.listProjectWorkItems(project.id, {
      status: parseCsvEnum(c.req.query('status'), WORK_ITEM_STATUSES),
      priority: parseCsvEnum(c.req.query('priority'), WORK_ITEM_PRIORITIES),
      includeArchived: c.req.query('includeArchived') === 'true',
      search: c.req.query('search'),
      sortBy: c.req.query('sortBy') as 'updatedAt' | 'createdAt' | 'priority' | 'status' | undefined,
      sortOrder: c.req.query('sortOrder') as 'asc' | 'desc' | undefined,
      limit: parseLimit(c.req.query('limit')),
      offset: c.req.query('offset') ? Math.max(0, Number.parseInt(c.req.query('offset')!, 10) || 0) : undefined,
    });
    return c.json({ ok: true, ...result });
  });

  authenticated.post('/api/projects/:id/work-items', async (c) => {
    const project = service.projects.get(c.req.param('id'));
    if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);
    const contentType = c.req.header('content-type') || '';
    let body: Record<string, unknown>;
    let files: File[] = [];
    if (contentType.includes('multipart/form-data')) {
      try {
        body = await c.req.parseBody({ all: true }) as Record<string, unknown>;
      } catch {
        return c.json({ ok: false, error: 'Invalid multipart body' }, 400);
      }
      files = collectUploadedFiles(body);
    } else {
      body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    }
    const attachmentError = validateUploadedWorkItemFiles(files);
    if (attachmentError) return c.json({ ok: false, error: attachmentError }, 413);
    const title = textField(body, 'title')?.trim();
    if (!title) return c.json({ ok: false, error: 'Work item title is required' }, 400);
    const status = parseEnumValue(body.status, WORK_ITEM_STATUSES);
    const priority = parseEnumValue(body.priority, WORK_ITEM_PRIORITIES);
    const dueAt = finiteNumberField(body.dueAt);
    if (Object.hasOwn(body, 'status') && !status) return c.json({ ok: false, error: 'Invalid work item status' }, 400);
    if (Object.hasOwn(body, 'priority') && !priority) return c.json({ ok: false, error: 'Invalid work item priority' }, 400);
    if (Object.hasOwn(body, 'dueAt') && dueAt === undefined && body.dueAt !== null) return c.json({ ok: false, error: 'Invalid dueAt' }, 400);
    const uploads: Array<{ name: string; buffer: Buffer; mimeType: string }> = [];
    for (const file of files) {
      uploads.push(await uploadedFileToBuffer(file));
    }
    const item = workItems.createProjectWorkItem(project.id, {
      title,
      description: textField(body, 'description'),
      status,
      priority,
      ownerAgentId: textField(body, 'ownerAgentId') || project.defaultAgentId || undefined,
      nextAction: textField(body, 'nextAction'),
      blockedReason: textField(body, 'blockedReason'),
      dueAt,
    });
    for (const upload of uploads) {
      await workItems.addAttachment(item.id, upload);
    }
    const created = files.length > 0 ? workItems.getWorkItem(item.id) ?? item : item;
    return c.json({ ok: true, item: created }, 201);
  });

  authenticated.get('/api/work-items/:id', async (c) => {
    const item = workItems.getWorkItem(c.req.param('id'));
    if (!item) return c.json({ ok: false, error: 'Work item not found' }, 404);
    return c.json({ ok: true, item });
  });

  authenticated.get('/api/work-items/:id/attachments', async (c) => {
    const attachments = workItems.listAttachments(c.req.param('id'));
    if (!attachments) return c.json({ ok: false, error: 'Work item not found' }, 404);
    return c.json({ ok: true, attachments });
  });

  authenticated.post('/api/work-items/:id/attachments', async (c) => {
    const item = workItems.getWorkItem(c.req.param('id'));
    if (!item) return c.json({ ok: false, error: 'Work item not found' }, 404);
    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody({ all: true }) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: 'Invalid multipart body' }, 400);
    }
    const files = collectUploadedFiles(body);
    if (!files.length) return c.json({ ok: false, error: 'Missing file field' }, 400);
    const attachmentError = validateUploadedWorkItemFiles(files);
    if (attachmentError) return c.json({ ok: false, error: attachmentError }, 413);
    const attachments = [];
    for (const file of files) {
      const upload = await uploadedFileToBuffer(file);
      const attachment = await workItems.addAttachment(item.id, upload);
      if (attachment) attachments.push(attachment);
    }
    return c.json({ ok: true, attachments, item: workItems.getWorkItem(item.id) }, 201);
  });

  authenticated.get('/api/work-items/:id/attachments/:attachmentId/content', async (c) => {
    const result = await workItems.readAttachment(c.req.param('id'), c.req.param('attachmentId'));
    if (!result) return c.json({ ok: false, error: 'Attachment not found' }, 404);
    return new Response(result.buffer, {
      headers: {
        'Content-Type': result.attachment.mimeType,
        'Content-Length': String(result.attachment.size),
        'Content-Disposition': `inline; filename="${encodeURIComponent(result.attachment.fileName)}"`,
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  });

  authenticated.delete('/api/work-items/:id/attachments/:attachmentId', async (c) => {
    const attachment = await workItems.removeAttachment(c.req.param('id'), c.req.param('attachmentId'));
    if (!attachment) return c.json({ ok: false, error: 'Attachment not found' }, 404);
    return c.json({ ok: true, attachment, item: workItems.getWorkItem(c.req.param('id')) });
  });

  authenticated.patch('/api/work-items/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const status = Object.hasOwn(body, 'status')
      ? parseEnumValue(body.status, WORK_ITEM_STATUSES)
      : undefined;
    const priority = Object.hasOwn(body, 'priority')
      ? parseEnumValue(body.priority, WORK_ITEM_PRIORITIES)
      : undefined;
    const dueAt = Object.hasOwn(body, 'dueAt')
      ? (body.dueAt === null ? null : (typeof body.dueAt === 'number' && Number.isFinite(body.dueAt) ? body.dueAt : undefined))
      : undefined;
    const archivedAt = Object.hasOwn(body, 'archivedAt')
      ? (body.archivedAt === null ? null : (typeof body.archivedAt === 'number' && Number.isFinite(body.archivedAt) ? body.archivedAt : undefined))
      : undefined;
    if (status === undefined && Object.hasOwn(body, 'status')) return c.json({ ok: false, error: 'Invalid work item status' }, 400);
    if (priority === undefined && Object.hasOwn(body, 'priority')) return c.json({ ok: false, error: 'Invalid work item priority' }, 400);
    if (dueAt === undefined && Object.hasOwn(body, 'dueAt')) return c.json({ ok: false, error: 'Invalid dueAt' }, 400);
    if (archivedAt === undefined && Object.hasOwn(body, 'archivedAt')) return c.json({ ok: false, error: 'Invalid archivedAt' }, 400);

    const item = workItems.updateWorkItem(c.req.param('id'), {
      ...(Object.hasOwn(body, 'title') ? { title: textField(body, 'title') ?? '' } : {}),
      ...(Object.hasOwn(body, 'description') ? { description: optionalTextField(body, 'description') } : {}),
      ...(Object.hasOwn(body, 'status') ? { status } : {}),
      ...(Object.hasOwn(body, 'priority') ? { priority } : {}),
      ...(Object.hasOwn(body, 'ownerAgentId') ? { ownerAgentId: optionalTextField(body, 'ownerAgentId') } : {}),
      ...(Object.hasOwn(body, 'nextAction') ? { nextAction: optionalTextField(body, 'nextAction') } : {}),
      ...(Object.hasOwn(body, 'blockedReason') ? { blockedReason: optionalTextField(body, 'blockedReason') } : {}),
      ...(Object.hasOwn(body, 'dueAt') ? { dueAt } : {}),
      ...(Object.hasOwn(body, 'archivedAt') ? { archivedAt } : {}),
    });
    if (!item) return c.json({ ok: false, error: 'Work item not found' }, 404);
    return c.json({ ok: true, item });
  });

  authenticated.delete('/api/work-items/:id', async (c) => {
    const item = workItems.updateWorkItem(c.req.param('id'), { archivedAt: Date.now() });
    if (!item) return c.json({ ok: false, error: 'Work item not found' }, 404);
    return c.json({ ok: true, item });
  });

  authenticated.get('/api/work-items/:id/events', async (c) => {
    const item = workItems.getWorkItem(c.req.param('id'));
    if (!item) return c.json({ ok: false, error: 'Work item not found' }, 404);
    return c.json({ ok: true, events: workItems.listEvents(item.id) });
  });

  authenticated.get('/api/work-items/:id/update-suggestions', async (c) => {
    const item = workItems.getWorkItem(c.req.param('id'));
    if (!item) return c.json({ ok: false, error: 'Work item not found' }, 404);
    const status = parseEnumValue(c.req.query('status'), WORK_ITEM_SUGGESTION_STATUSES);
    if (c.req.query('status') && !status) return c.json({ ok: false, error: 'Invalid suggestion status' }, 400);
    return c.json({ ok: true, suggestions: workItems.listUpdateSuggestions(item.id, status) });
  });

  authenticated.post('/api/work-items/:id/update-suggestions', async (c) => {
    const item = workItems.getWorkItem(c.req.param('id'));
    if (!item) return c.json({ ok: false, error: 'Work item not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const sourceKind = parseEnumValue(body.sourceKind, ['chat', 'goal', 'workflow_run', 'automation'] as const);
    const sourceId = textField(body, 'sourceId')?.trim();
    if (!sourceKind) return c.json({ ok: false, error: 'Invalid sourceKind' }, 400);
    if (!sourceId) return c.json({ ok: false, error: 'sourceId is required' }, 400);
    const patchBody = body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch)
      ? body.patch as Record<string, unknown>
      : {};
    const status = Object.hasOwn(patchBody, 'status')
      ? parseEnumValue(patchBody.status, WORK_ITEM_STATUSES)
      : undefined;
    if (Object.hasOwn(patchBody, 'status') && !status) return c.json({ ok: false, error: 'Invalid work item status' }, 400);
    const confidence = typeof body.confidence === 'number' && Number.isFinite(body.confidence)
      ? Math.max(0, Math.min(1, body.confidence))
      : undefined;
    const suggestion = workItems.createUpdateSuggestion(item.id, {
      sourceKind,
      sourceId,
      patch: {
        ...(Object.hasOwn(patchBody, 'status') ? { status } : {}),
        ...(Object.hasOwn(patchBody, 'nextAction') ? { nextAction: optionalTextField(patchBody, 'nextAction') } : {}),
        ...(Object.hasOwn(patchBody, 'blockedReason') ? { blockedReason: optionalTextField(patchBody, 'blockedReason') } : {}),
      },
      progressNote: optionalTextField(body, 'progressNote') ?? undefined,
      rationale: optionalTextField(body, 'rationale') ?? undefined,
      confidence,
    });
    if (!suggestion) return c.json({ ok: false, error: 'Work item not found' }, 404);
    return c.json({ ok: true, suggestion }, 201);
  });

  authenticated.post('/api/work-item-update-suggestions/:id/apply', async (c) => {
    const result = workItems.applyUpdateSuggestion(c.req.param('id'));
    if (!result) return c.json({ ok: false, error: 'Suggestion not found or already resolved' }, 404);
    return c.json({ ok: true, item: result.item, suggestion: result.suggestion });
  });

  authenticated.post('/api/work-item-update-suggestions/:id/dismiss', async (c) => {
    const suggestion = workItems.dismissUpdateSuggestion(c.req.param('id'));
    if (!suggestion) return c.json({ ok: false, error: 'Suggestion not found or already resolved' }, 404);
    return c.json({ ok: true, suggestion });
  });

  authenticated.post('/api/work-items/:id/start-chat', async (c) => {
    const item = workItems.getWorkItem(c.req.param('id'));
    if (!item) return c.json({ ok: false, error: 'Work item not found' }, 404);
    const project = service.projects.get(item.projectId);
    if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);
    const agentId = resolveProjectAgentId({
      config: service.currentConfig,
      projects: service.projects,
      explicitAgentId: item.ownerAgentId,
      projectId: project.id,
    });
    const peerId = `work_item_${Date.now()}`;
    const sessionKey = buildSessionKey({
      agentId,
      source: 'webchat',
      accountId: 'default',
      peerKind: 'direct',
      peerId,
    });
    await service.sessionIndexInstance.saveMessages(sessionKey, [], {
      metadata: buildWorkItemChatSessionMetadata({
        agentId,
        accountId: 'default',
        peerId,
        workItemId: item.id,
        title: item.title,
        updatedAt: item.updatedAt,
      }),
    });
    service.projects.attachSession(sessionKey, project.id);
    const session = await service.sessions.getSession(sessionKey);
    workItems.addLink(item.id, {
      kind: 'chat',
      targetId: sessionKey,
      title: session?.name || item.title,
      statusSnapshot: session?.status,
    }, 'chat_started');
    const updated = item.status === 'todo' || item.status === 'backlog'
      ? workItems.updateWorkItem(item.id, { status: 'in_progress' })
      : workItems.getWorkItem(item.id);
    return c.json({ ok: true, session, item: updated }, 201);
  });

  authenticated.post('/api/work-items/:id/create-goal', async (c) => {
    const item = workItems.getWorkItem(c.req.param('id'));
    if (!item) return c.json({ ok: false, error: 'Work item not found' }, 404);
    const project = service.projects.get(item.projectId);
    if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);
    const attachments = await workItems.snapshotAttachmentsForGoal(item.id);
    if (!attachments) return c.json({ ok: false, error: 'Work item not found' }, 404);
    const context = await buildWorkItemAgentContext(item, { attachments, includeImages: false });
    const goal = goals.create({
      title: item.title,
      description: item.description || item.nextAction,
      priority: item.priority === 'urgent' ? 'high' : item.priority,
      agentId: item.ownerAgentId || project.defaultAgentId || undefined,
      projectId: project.id,
      source: 'api',
      config: service.currentConfig,
    });
    const goalWithContext = goals.setContextMessage({
      goalId: goal.id,
      text: context.text,
      attachments,
    }) ?? goal;
    workItems.addLink(item.id, {
      kind: 'goal',
      targetId: goal.id,
      title: goal.title,
      statusSnapshot: goal.status,
    }, 'goal_created');
    const updated = item.status === 'todo' || item.status === 'backlog'
      ? workItems.updateWorkItem(item.id, { status: 'in_progress' })
      : workItems.getWorkItem(item.id);
    return c.json({ ok: true, goal: goalWithContext, item: updated }, 201);
  });

  authenticated.post('/api/projects/:id/digest-memory', async (c) => {
    const project = service.projects.getWithDetails(c.req.param('id'));
    if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);
    const goalIds = service.projects.listGoalIds(project.id, 100);
    const projectGoals = goalIds
      .map((id) => goals.get(id))
      .filter((goal): goal is GoalWithDetails => Boolean(goal));
    const loop = buildProjectLoopOverview({
      project,
      goals: projectGoals,
      recentWorkflowRuns: project.recentWorkflowRuns,
      failedWorkflowRuns: listFailedProjectWorkflowRuns(project.id),
      memoryRecords: listMemoryRecords({ projectId: project.id, status: 'active', limit: 5 }),
    });
    const record = upsertMemoryRecord({
      id: projectDigestMemoryRecordId(project.id),
      providerId: 'local',
      kind: 'daily_note',
      agentId: resolveProjectAgentId({
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
    const goal = goals.create({
      title,
      description: reason || undefined,
      agentId: resolveProjectAgentId({
        config: service.currentConfig,
        projects: service.projects,
        projectId: project.id,
      }),
      priority: body.priority === 'low' || body.priority === 'normal' || body.priority === 'high' ? body.priority : 'high',
      source: 'api',
      projectId: project.id,
    });
    const blocked = goals.setStatus(goal.id, 'blocked', { reason: reason || title });
    if (reason) {
      goals.setContextMessage({ goalId: goal.id, text: reason });
    }
    return c.json({ ok: true, goal: blocked ?? goals.get(goal.id) }, 201);
  });

  authenticated.get('/api/projects/:id', async (c) => {
    const project = service.projects.getWithDetails(c.req.param('id'));
    if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);
    return c.json({ ok: true, project: enrichProjectWorkspace(service, project) });
  });

  authenticated.patch('/api/projects/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const status = parseProjectStatus(body.status);
    const defaultAgentPatch = optionalTextField(body, 'defaultAgentId');
    const defaultAgentId = defaultAgentPatch === undefined ? undefined : normalizeProjectAgentId(defaultAgentPatch);
    if (defaultAgentId && !isValidProjectAgentId(service.currentConfig, defaultAgentId)) {
      return c.json({ ok: false, error: 'Default agent not found' }, 400);
    }
    try {
      const project = service.projects.update(c.req.param('id'), {
        ...(textField(body, 'name') !== undefined ? { name: textField(body, 'name') } : {}),
        ...(optionalTextField(body, 'description') !== undefined ? { description: optionalTextField(body, 'description') } : {}),
        ...(status ? { status } : {}),
        ...(defaultAgentPatch !== undefined ? { defaultAgentId: defaultAgentId ?? null } : {}),
        ...(optionalTextField(body, 'workspaceRoot') !== undefined ? { workspaceRoot: optionalTextField(body, 'workspaceRoot') } : {}),
        createWorkspaceRoot: body.createWorkspaceRoot === true,
        ...(optionalTextField(body, 'brief') !== undefined ? { brief: optionalTextField(body, 'brief') } : {}),
        ...(optionalTextField(body, 'instructions') !== undefined ? { instructions: optionalTextField(body, 'instructions') } : {}),
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
    service.projects.delete(c.req.param('id'));
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

  authenticated.get('/api/projects/:id/goals', async (c) => {
    try {
      const ids = service.projects.listGoalIds(c.req.param('id'), parseLimit(c.req.query('limit'), 100));
      return c.json({ ok: true, goals: ids.map((id) => goals.get(id)).filter(Boolean) });
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
    } catch {
      st = null;
    }
    const displayName = path.basename(rawPath);
    if (!st) {
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
      agentId: session.routing?.agentId ?? 'main',
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

  authenticated.post('/api/projects/:id/goals/:goalId', async (c) => {
    try {
      service.projects.attachGoal(c.req.param('goalId'), c.req.param('id'));
      return c.json({ ok: true, goal: goals.get(c.req.param('goalId')) });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 404);
    }
  });

  authenticated.delete('/api/projects/:id/goals/:goalId', async (c) => {
    try {
      const projectId = c.req.param('id');
      const goalId = c.req.param('goalId');
      if (!service.projects.get(projectId)) {
        return c.json({ ok: false, error: 'Project not found' }, 404);
      }
      const goal = goals.get(goalId);
      if (!goal) {
        return c.json({ ok: false, error: 'Goal not found' }, 404);
      }
      if (goal.projectId !== projectId) {
        return c.json({ ok: false, error: 'Goal is not attached to this project' }, 409);
      }
      service.projects.detachGoal(goalId);
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 404);
    }
  });
}
