import type { Context, Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { ProductReadContracts, ProjectResolveWorkspaceOutputSchema, ProjectDeleteOutputSchema, ProjectMutationOutputSchema, ProjectMilestoneOutputSchema, ProjectMilestoneDeleteOutputSchema, ProjectUpdateOutputSchema } from '@xopcai/gateway-contract';
import { CapabilityError } from '../../../capabilities/runtime/dispatcher.js';
import { createProductDispatcher } from '../../../capabilities/runtime/product.js';
import { capabilityHttpContext, capabilityHttpError } from '../../../capabilities/adapters/http.js';

import { ActivityService } from '../../../activity/index.js';
import { resolveEffectiveAgentProfile } from '../../../config/agent-profile.js';
import {
  buildProjectLoopOverview,
  inferProjectKind,
  inferProjectExecutionMode,
  inferSuggestedProjectDefaultAgentId,
  ProjectWorkspaceConflictError,
  ProjectWorkspaceMissingError,
  type Project,
  resolveProjectAgentId,
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
  loadTranscriptRowsForSession,
} from '../../../storage/sqlite/index.js';
import { listKnowledgeItems, writeKnowledgeItem } from '../../../knowledge-memory/index.js';
import { parseActivityIncludeRelated, parseActivityQuery } from './activity.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { ProjectDeletionBlockedError, ProjectWorkspaceInUseError } from '../../../projects/project-service.js';

function projectWriteError(c: Context, error: unknown): Response {
  const cause = error instanceof CapabilityError ? error.cause : error;
  if (cause instanceof ProjectWorkspaceConflictError) {
    return c.json({ ok: false, code: 'workspace_already_bound', error: cause.message, project: cause.project }, 409);
  }
  if (cause instanceof ProjectWorkspaceMissingError) {
    return c.json({ ok: false, code: 'workspace_root_missing', error: cause.message, workspaceRoot: cause.workspaceRoot }, 409);
  }
  if (cause instanceof ProjectWorkspaceInUseError || cause instanceof ProjectDeletionBlockedError) {
    return c.json({ ok: false, code: 'execution_environments_exist', error: cause.message }, 409);
  }
  return capabilityHttpError(c, error);
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
  return resolveEffectiveAgentProfile(agentId).resolvedWorkspacePath;
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

function buildSessionSummaryKnowledgeContent(conversationId: string, explicitSummary?: string): string {
  const summary = explicitSummary?.trim();
  if (summary) return summary;
  const rows = loadTranscriptRowsForSession(conversationId)
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
    ? [`Session summary for ${conversationId}:`, ...lines].join('\n')
    : `Session summary for ${conversationId}: no transcript content available.`;
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

function buildProjectDigestKnowledgeContent(input: ReturnType<typeof buildProjectLoopOverview> & { projectName: string }): string {
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

export function registerProjectsRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;
  const capabilities = createProductDispatcher(undefined, {
    getProjects: () => service.projects, getConfig: () => service.currentConfig, getWorkDiscovery: () => service.workDiscovery,
  });
  const invokeWrite = (c: Context, operation: string, input: unknown) => {
    const caller = capabilityHttpContext(c);
    return capabilities.call(operation, input, caller, { ...capabilities.describe(operation, caller), idempotencyKey: c.req.header('idempotency-key') ?? randomUUID() });
  };
  const readBody = async (c: Context): Promise<Record<string, unknown>> => {
    const body = await c.req.json().catch(() => { throw new CapabilityError('INVALID_INPUT', 'Invalid JSON body'); });
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CapabilityError('INVALID_INPUT', 'Expected an object');
    return body;
  };
  const readOptionalBody = async (c: Context): Promise<Record<string, unknown>> => {
    const text = await c.req.text();
    if (!text.length) return {};
    let body: unknown;
    try { body = JSON.parse(text); }
    catch { throw new CapabilityError('INVALID_INPUT', 'Invalid JSON body'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CapabilityError('INVALID_INPUT', 'Expected an object');
    return body as Record<string, unknown>;
  };
  const milestoneRevision = (c: Context, revision: unknown) => {
    if (revision !== undefined) return revision;
    if (c.req.header('idempotency-key')) throw new CapabilityError('INVALID_INPUT', 'Stable retries require the original expectedRevision');
    const milestone = service.projects.listMilestones(c.req.param('id')!).find(item => item.id === c.req.param('milestoneId'));
    if (!milestone) throw new CapabilityError('NOT_FOUND', 'Milestone not found');
    return milestone.updatedAt;
  };
  const activity = new ActivityService();
  const operatingViews = new ProjectOperatingViewService(service.projects);

  authenticated.post('/api/projects', async (c) => {
    try {
      const { project } = ProjectMutationOutputSchema.parse(await invokeWrite(c, 'xopc.projects.create', await readBody(c)));
      return c.json({ ok: true, project: enrichProjectWorkspace(service, project) }, 201);
    } catch (error) { return projectWriteError(c, error); }
  });

  authenticated.get('/api/projects', async (c) => {
    try {
    const { includeOperating: _includeOperating, ...input } = c.req.query();
    const result = ProductReadContracts['xopc.projects.list'].output.parse(await capabilities.call('xopc.projects.list', {
      ...input, limit: input.limit === undefined ? undefined : Number(input.limit), offset: input.offset === undefined ? undefined : Number(input.offset),
    }, capabilityHttpContext(c)));
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
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/projects/suggestions', async (c) => {
    const conversationId = c.req.query('conversationId')?.trim();
    return c.json({ ok: true, suggestions: conversationId ? service.projects.suggestProjectsForSession(conversationId) : [] });
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
    try {
      const body = await readBody(c);
      return c.json(ProjectResolveWorkspaceOutputSchema.parse(await invokeWrite(c, 'xopc.projects.resolve_workspace', {
        ...body, agentId: body.agentId ?? 'main', autoCreate: body.autoCreate ?? true,
      })));
    } catch (error) { return projectWriteError(c, error); }
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

 authenticated.post('/api/projects/:id/digest-knowledge', async (c) => {
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
      knowledgeItems: listKnowledgeItems({ statuses: ['active'], limit: 500 })
        .filter((item) => item.scope.type === 'project' && item.scope.id === project.id)
        .slice(0, 5),
    });
    const record = writeKnowledgeItem({
      kind: 'note',
      scope: { type: 'project', id: project.id },
      sourceAgentId: resolveProjectAgentId({
        config: service.currentConfig,
        projects: service.projects,
        projectId: project.id,
      }),
      content: buildProjectDigestKnowledgeContent({ ...loop, projectName: project.name }),
      canonicalKey: `project-digest:${project.id}`,
      source: {
        provider: 'project-digest',
      },
      confidence: 0.75,
      importance: 0.7,
      status: 'active',
      originClass: 'system',
      replaceExisting: true,
    });
    if (!record.item) return c.json({ ok: false, error: 'This memory was deleted and automatic recreation is disabled.' }, 409);
    return c.json({ ok: true, knowledge: record.item }, 201);
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

  for (const [action, pinned] of [['pin', true], ['unpin', false]] as const) {
    authenticated.post(`/api/projects/:id/${action}`, async (c) => {
      try {
        const body = await readOptionalBody(c);
        if (Object.keys(body).some(key => key !== 'expectedVersion')) throw new CapabilityError('INVALID_INPUT', 'Unexpected pin input');
        if (body.expectedVersion === undefined && c.req.header('idempotency-key')) {
          throw new CapabilityError('INVALID_INPUT', 'Stable retries require the original expectedVersion');
        }
        const id = c.req.param('id');
        const project = body.expectedVersion === undefined ? service.projects.get(id) : undefined;
        if (body.expectedVersion === undefined && !project) throw new CapabilityError('NOT_FOUND', 'Project not found');
        const result = ProjectMutationOutputSchema.parse(await invokeWrite(c, 'xopc.projects.set_pinned', {
          id, pinned, expectedVersion: body.expectedVersion ?? project?.version,
        }));
        return c.json({ ok: true, project: enrichProjectWorkspace(service, result.project) });
      } catch (error) { return capabilityHttpError(c, error); }
    });
  }

  authenticated.get('/api/projects/:id', async (c) => {
    try {
      const { project } = ProductReadContracts['xopc.projects.get'].output.parse(await capabilities.call('xopc.projects.get', { id: c.req.param('id') }, capabilityHttpContext(c)));
      return c.json({ ok: true, project: enrichProjectWorkspace(service, project) });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/projects/:id/milestones', async (c) => {
    try {
      const { items } = ProductReadContracts['xopc.projects.list_milestones'].output.parse(await capabilities.call('xopc.projects.list_milestones', { id: c.req.param('id') }, capabilityHttpContext(c)));
      return c.json({ ok: true, items });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.post('/api/projects/:id/milestones', async (c) => {
    try {
      const body = await readBody(c);
      const { milestone } = ProjectMilestoneOutputSchema.parse(await invokeWrite(c, 'xopc.projects.create_milestone', { ...body, projectId: c.req.param('id') }));
      return c.json({ ok: true, milestone }, 201);
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.patch('/api/projects/:id/milestones/:milestoneId', async (c) => {
    try {
      const { expectedRevision, ...patch } = await readBody(c);
      const { milestone } = ProjectMilestoneOutputSchema.parse(await invokeWrite(c, 'xopc.projects.update_milestone', {
        projectId: c.req.param('id'), id: c.req.param('milestoneId'), expectedRevision: milestoneRevision(c, expectedRevision), patch,
      }));
      return c.json({ ok: true, milestone });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.delete('/api/projects/:id/milestones/:milestoneId', async (c) => {
    try {
      const raw = await c.req.text();
      let body: Record<string, unknown> = {};
      if (raw) {
        try { body = JSON.parse(raw); } catch { throw new CapabilityError('INVALID_INPUT', 'Invalid JSON body'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CapabilityError('INVALID_INPUT', 'Expected an object');
      }
      ProjectMilestoneDeleteOutputSchema.parse(await invokeWrite(c, 'xopc.projects.delete_milestone', {
        projectId: c.req.param('id'), id: c.req.param('milestoneId'), expectedRevision: milestoneRevision(c, body.expectedRevision),
      }));
      return c.json({ ok: true });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/projects/:id/updates', async (c) => {
    try {
      const { items } = ProductReadContracts['xopc.projects.list_updates'].output.parse(await capabilities.call('xopc.projects.list_updates', {
        id: c.req.param('id'), limit: c.req.query('limit') === undefined ? undefined : Number(c.req.query('limit')),
      }, capabilityHttpContext(c)));
      return c.json({ ok: true, items });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.post('/api/projects/:id/updates', async (c) => {
    try {
      const body = await readBody(c);
      if (c.req.header('idempotency-key') && body.expectedVersion === undefined) throw new CapabilityError('INVALID_INPUT', 'Stable retries require the original expectedVersion');
      const project = service.projects.get(c.req.param('id'));
      if (!project && body.expectedVersion === undefined) throw new CapabilityError('NOT_FOUND', 'Project not found');
      const { update } = ProjectUpdateOutputSchema.parse(await invokeWrite(c, 'xopc.projects.create_update', {
        ...body, projectId: c.req.param('id'), expectedVersion: body.expectedVersion === undefined ? project?.version : body.expectedVersion,
      }));
      return c.json({ ok: true, update }, 201);
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.patch('/api/projects/:id', async (c) => {
    try {
      const { expectedVersion, ...patch } = await readBody(c);
      if (expectedVersion === undefined && c.req.header('idempotency-key')) {
        throw new CapabilityError('INVALID_INPUT', 'Stable retries require the original expectedVersion');
      }
      const id = c.req.param('id');
      const current = expectedVersion === undefined ? service.projects.get(id) : undefined;
      if (expectedVersion === undefined && !current) throw new CapabilityError('NOT_FOUND', 'Project not found');
      const { project } = ProjectMutationOutputSchema.parse(await invokeWrite(c, 'xopc.projects.update', {
        id, expectedVersion: expectedVersion === undefined ? current?.version : expectedVersion, patch,
      }));
      return c.json({ ok: true, project: enrichProjectWorkspace(service, project) });
    } catch (error) { return projectWriteError(c, error); }
  });

  authenticated.delete('/api/projects/:id', async (c) => {
    try {
      const body = await readOptionalBody(c);
      if (Object.keys(body).some(key => key !== 'expectedVersion')) throw new CapabilityError('INVALID_INPUT', 'Unexpected delete input');
      if (body.expectedVersion === undefined && c.req.header('idempotency-key')) {
        throw new CapabilityError('INVALID_INPUT', 'Stable retries require the original expectedVersion');
      }
      const id = c.req.param('id');
      const project = body.expectedVersion === undefined ? service.projects.get(id) : undefined;
      if (body.expectedVersion === undefined && !project) throw new CapabilityError('NOT_FOUND', 'Project not found');
      const result = ProjectDeleteOutputSchema.parse(await invokeWrite(c, 'xopc.projects.delete', {
        id, expectedVersion: body.expectedVersion === undefined ? project?.version : body.expectedVersion,
      }));
      return c.json(result);
    } catch (error) {
      if (error instanceof CapabilityError && error.cause instanceof ProjectDeletionBlockedError) {
        return c.json({ ok: false, code: 'execution_environments_exist', error: error.message }, 409);
      }
      return capabilityHttpError(c, error);
    }
  });

  authenticated.get('/api/projects/:id/sessions', async (c) => {
    try {
      const keys = service.projects.listConversationIds(c.req.param('id'), parseLimit(c.req.query('limit'), 100));
      const sessions = await Promise.all(keys.map((key) => service.sessions.getSession(key)));
      return c.json({
        ok: true,
        sessions: sessions.filter((session) => session && !session.hiddenFromSessionList),
      });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 404);
    }
  });


  authenticated.post('/api/projects/:id/sessions/:conversationId', async (c) => {
    try {
      service.projects.attachSession(c.req.param('conversationId'), c.req.param('id'));
      const session = await service.sessions.getSession(c.req.param('conversationId'));
      return c.json({ ok: true, session });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 404);
    }
  });

  authenticated.delete('/api/projects/:id/sessions/:conversationId', async (c) => {
    try {
      const projectId = c.req.param('id');
      const conversationId = c.req.param('conversationId');
      if (!service.projects.get(projectId)) {
        return c.json({ ok: false, error: 'Project not found' }, 404);
      }
      const session = await service.sessions.getSession(conversationId);
      if (!session) {
        return c.json({ ok: false, error: 'Session not found' }, 404);
      }
      if (session.projectId !== projectId) {
        return c.json({ ok: false, error: 'Session is not attached to this project' }, 409);
      }
      service.projects.detachSession(conversationId);
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 404);
    }
  });

  authenticated.post('/api/projects/:id/sessions/:conversationId/summary-knowledge', async (c) => {
    const projectId = c.req.param('id');
    const conversationId = c.req.param('conversationId');
    const project = service.projects.get(projectId);
    if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);
    const session = getSessionMetadata(conversationId);
    if (!session) return c.json({ ok: false, error: 'Session not found' }, 404);
    if (session.projectId !== projectId) {
      return c.json({ ok: false, error: 'Session is not attached to this project' }, 409);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const content = buildSessionSummaryKnowledgeContent(
      conversationId,
      typeof body.summary === 'string' ? body.summary : undefined,
    );
    const record = writeKnowledgeItem({
      kind: 'episode',
      scope: { type: 'project', id: projectId },
      sourceAgentId: session.routing?.agentId ?? 'main',
      sourceConversationId: conversationId,
      content,
      canonicalKey: `project-session-summary:${projectId}:${conversationId}`,
      source: {
        provider: 'project-summary',
        sessionEntryId: conversationId,
      },
      confidence: typeof body.confidence === 'number' ? body.confidence : 0.7,
      importance: 0.6,
      status: 'active',
      originClass: 'agent',
      replaceExisting: true,
    });
    if (!record.item) return c.json({ ok: false, error: 'This memory was deleted and automatic recreation is disabled.' }, 409);
    return c.json({ ok: true, knowledge: record.item }, 201);
  });

}
