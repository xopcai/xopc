import type { Hono } from 'hono';
import { readdir, realpath, stat } from 'node:fs/promises';
import * as path from 'node:path';

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
  resolveProjectAgentId,
  type ProjectStatus,
  type ProjectWorkflowRunBrief,
} from '../../../projects/index.js';
import {
  getSqliteDatabase,
  getSessionMetadata,
  listMemoryRecords,
  loadTranscriptRowsForSession,
  upsertMemoryRecord,
} from '../../../storage/sqlite/index.js';
import { createGatewayRouteLogger } from '../lib/route-logger.js';
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

function textField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' ? value : undefined;
}

function optionalTextField(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  return typeof value === 'string' ? value : null;
}

const SKIP_FILE_NAMES = new Set(['.git', 'node_modules']);

function normalizeRelativePath(raw: string | undefined): string {
  const normalized = (raw ?? '').trim().replaceAll('\\', '/');
  return normalized.replace(/^\/+/, '');
}

function isWithinDirectory(root: string, target: string): boolean {
  const relativePath = path.relative(root, target);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
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
  const goals = new GoalService();

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
      return c.json({ ok: true, project }, 201);
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
    return c.json({ ok: true, ...result });
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
        project,
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
    return c.json({ ok: true, project });
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
      return c.json({ ok: true, project });
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
      return c.json({ ok: true, sessions: sessions.filter(Boolean) });
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
    const project = service.projects.get(c.req.param('id'));
    if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);
    if (!project.workspaceRoot?.trim()) {
      return c.json({ ok: false, error: 'Project workspace root is not set' }, 400);
    }

    let root: string;
    try {
      root = await realpath(project.workspaceRoot);
      const rootStat = await stat(root);
      if (!rootStat.isDirectory()) {
        return c.json({ ok: false, error: 'Project workspace root is not a directory' }, 400);
      }
    } catch (err) {
      log.warn({ err, projectId: project.id, path: project.workspaceRoot }, 'project workspace root unavailable');
      return c.json({ ok: false, error: 'Project workspace root is unavailable' }, 404);
    }

    const requestedPath = normalizeRelativePath(c.req.query('path'));
    const candidate = path.resolve(root, requestedPath);
    if (!isWithinDirectory(root, candidate)) {
      return c.json({ ok: false, error: 'Path is outside project workspace' }, 400);
    }

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
      log.warn({ err, projectId: project.id, path: candidate }, 'project file path unavailable');
      return c.json({ ok: false, error: 'Path not found' }, 404);
    }

    try {
      const dirents = await readdir(currentPath, { withFileTypes: true });
      const entries = await Promise.all(dirents
        .filter((entry) => !SKIP_FILE_NAMES.has(entry.name))
        .map(async (entry) => {
          const absolutePath = path.join(currentPath, entry.name);
          const entryStat = await stat(absolutePath).catch(() => null);
          const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
          return {
            name: entry.name,
            path: relativePath,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: entryStat?.isFile() ? entryStat.size : undefined,
            updatedAt: entryStat?.mtime.toISOString(),
          };
        }));
      entries.sort((left, right) => {
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
        entries,
      });
    } catch (err) {
      log.warn({ err, projectId: project.id, path: currentPath }, 'project file list failed');
      if ((err as NodeJS.ErrnoException)?.code === 'EACCES') {
        return c.json({ ok: false, error: 'Permission denied' }, 403);
      }
      return c.json({ ok: false, error: 'Failed to read project files' }, 500);
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
