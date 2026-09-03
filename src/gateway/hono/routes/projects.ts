import type { Hono } from 'hono';
import { randomUUID } from 'node:crypto';

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
import { parseActivityIncludeRelated, parseActivityQuery } from './activity.js';
import type { AuthenticatedRouteDeps } from './deps.js';

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
