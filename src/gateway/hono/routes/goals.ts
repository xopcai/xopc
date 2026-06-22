import type { Hono } from 'hono';

import { createWorkflowCatalog } from '../../../agent/workflow/catalog.js';
import {
  GoalService,
  normalizeGoalUiLocale,
  type GoalChecklistItem,
  type GoalEvent,
  type GoalEvidence,
  type GoalQueueItemSnapshot,
  type GoalRun,
  type GoalStatus,
} from '../../../goals/index.js';
import { buildSessionKey, sanitizeSegment } from '../../../routing/session-key.js';
import { getDefaultAgentId } from '../../../routing/resolve-route.js';
import type { WorkflowRunSummary } from '../../../workflows/domain/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function parseLimit(raw: string | undefined, fallback = 50): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(500, Math.max(1, n)) : fallback;
}

function parseStatuses(raw: string | undefined): GoalStatus[] | undefined {
  if (!raw?.trim()) return undefined;
  const statuses = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is GoalStatus =>
      s === 'active' ||
      s === 'paused' ||
      s === 'blocked' ||
      s === 'needs_input' ||
      s === 'done' ||
      s === 'archived',
    );
  return statuses.length ? statuses : undefined;
}

function parseBodyGoalStatus(raw: unknown): GoalStatus | null {
  return raw === 'active' ||
    raw === 'paused' ||
    raw === 'blocked' ||
    raw === 'needs_input' ||
    raw === 'done' ||
    raw === 'archived'
    ? raw
    : null;
}

function parsePriority(raw: unknown): 'low' | 'normal' | 'high' | undefined {
  return raw === 'low' || raw === 'normal' || raw === 'high' ? raw : undefined;
}

type GoalActivityItem = {
  id: string;
  kind: 'queue' | 'goal_run' | 'workflow_run' | 'event' | 'evidence';
  status?: string;
  title: string;
  summary?: string;
  createdAt: number;
  link?: { type: 'chat' | 'workflow_run'; value: string };
  data?: unknown;
};

type GoalWorkflowSuggestion = {
  definitionId: string;
  name: string;
  title: string;
  description: string;
  score: number;
  reasons: string[];
  tags: string[];
  successRate?: number;
  lastRunStatus?: WorkflowRunSummary['status'];
};

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'for',
  'in',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  '一个',
  '这个',
  '需要',
  '进行',
  '推进',
]);

function tokenizeForWorkflowMatch(text: string): string[] {
  const normalized = text.toLowerCase();
  const tokens = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return tokens
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function goalSearchText(goal: NonNullable<ReturnType<GoalService['get']>>): string {
  return [
    goal.title,
    goal.description,
    goal.nextAction,
    goal.blockedReason,
    ...goal.checklist.map((item: GoalChecklistItem) => `${item.text} ${item.evidenceSummary ?? ''}`),
  ].filter(Boolean).join('\n');
}

function buildGoalWorkflowSuggestions(params: {
  goal: NonNullable<ReturnType<GoalService['get']>>;
  workflowRuns: WorkflowRunSummary[];
}): GoalWorkflowSuggestion[] {
  const goalTokens = new Set(tokenizeForWorkflowMatch(goalSearchText(params.goal)));
  const runsByDefinition = new Map<string, WorkflowRunSummary[]>();
  for (const run of params.workflowRuns) {
    const list = runsByDefinition.get(run.definitionId) ?? [];
    list.push(run);
    runsByDefinition.set(run.definitionId, list);
  }

  const suggestions: GoalWorkflowSuggestion[] = [];
  for (const entry of createWorkflowCatalog().list()) {
    const candidateText = [
      entry.name,
      entry.title,
      entry.description,
      entry.whenToUse,
      ...(entry.tags ?? []),
    ].filter(Boolean).join('\n');
    const candidateTokens = new Set(tokenizeForWorkflowMatch(candidateText));
    const matched = [...goalTokens].filter((token) => candidateTokens.has(token));
    const relatedRuns = runsByDefinition.get(entry.name) ?? [];
    const terminalRuns = relatedRuns.filter((run) => run.status !== 'queued' && run.status !== 'running');
    const succeededRuns = terminalRuns.filter((run) => run.status === 'succeeded');
    const successRate = terminalRuns.length ? succeededRuns.length / terminalRuns.length : undefined;
    const lastRun = relatedRuns.toSorted((left, right) => right.createdAtMs - left.createdAtMs)[0];

    let score = matched.length * 8;
    if (entry.tags?.some((tag) => goalTokens.has(tag.toLowerCase()))) score += 8;
    if (entry.whenToUse && matched.length > 0) score += 4;
    if (successRate != null) score += Math.round(successRate * 10);
    if (lastRun?.status === 'succeeded') score += 4;
    if (lastRun?.status === 'failed' || lastRun?.status === 'timeout') score -= 3;
    if (score <= 0) score = entry.source === 'builtin' ? 1 : 0;

    const reasons: string[] = [];
    if (matched.length) reasons.push(`matches ${matched.slice(0, 4).join(', ')}`);
    if (successRate != null) reasons.push(`${Math.round(successRate * 100)}% success rate`);
    if (lastRun) reasons.push(`last run ${lastRun.status}`);
    if (!reasons.length && entry.whenToUse) reasons.push('general workflow fit');

    if (score > 0) {
      suggestions.push({
        definitionId: entry.name,
        name: entry.name,
        title: entry.title || entry.name,
        description: entry.description,
        score,
        reasons,
        tags: entry.tags ?? [],
        successRate,
        lastRunStatus: lastRun?.status,
      });
    }
  }

  return suggestions
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 5);
}

function buildGoalActivities(input: {
  goalId: string;
  queue: GoalQueueItemSnapshot[];
  runs: GoalRun[];
  workflowRuns: WorkflowRunSummary[];
  events: GoalEvent[];
  evidence: GoalEvidence[];
  limit: number;
}): GoalActivityItem[] {
  const activities: GoalActivityItem[] = [];

  for (const item of input.queue.filter((queueItem) => queueItem.goalId === input.goalId)) {
    activities.push({
      id: `queue:${item.id}`,
      kind: 'queue',
      status: item.status,
      title: 'Goal queued',
      summary: item.lastError || item.message || undefined,
      createdAt: item.finishedAt ?? item.startedAt ?? item.nextRunAt ?? item.enqueuedAt,
      link: item.sessionKey ? { type: 'chat', value: item.sessionKey } : undefined,
      data: item,
    });
  }

  for (const run of input.runs) {
    activities.push({
      id: `goal_run:${run.id}`,
      kind: 'goal_run',
      status: run.verdict ?? run.status,
      title: 'Goal run judged',
      summary: run.reason || run.assistantPreview || run.nextAction,
      createdAt: run.finishedAt ?? run.startedAt,
      data: run,
    });
  }

  for (const run of input.workflowRuns) {
    activities.push({
      id: `workflow_run:${run.id}`,
      kind: 'workflow_run',
      status: run.status,
      title: run.title || run.definitionId,
      summary: run.definitionId,
      createdAt: run.completedAtMs ?? run.startedAtMs ?? run.createdAtMs,
      link: { type: 'workflow_run', value: run.id },
      data: run,
    });
  }

  for (const event of input.events) {
    activities.push({
      id: `event:${event.id}`,
      kind: 'event',
      status: event.kind,
      title: event.kind,
      summary: event.message,
      createdAt: event.createdAt,
      data: event,
    });
  }

  for (const item of input.evidence) {
    activities.push({
      id: `evidence:${item.id}`,
      kind: 'evidence',
      status: item.kind,
      title: item.title,
      summary: item.summary || item.uri,
      createdAt: item.createdAt,
      data: item,
    });
  }

  return activities
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, input.limit);
}

function abortActiveWebchatRunForGoal(
  deps: AuthenticatedRouteDeps,
  goal: NonNullable<ReturnType<GoalService['get']>>,
): { aborted?: boolean; abortedRunId?: string } {
  const sessionKey = goal.activeSessionKey?.trim();
  if (!sessionKey) return {};
  const runId = deps.service.getActiveWebchatRunId(sessionKey);
  if (!runId) return {};
  return {
    abortedRunId: runId,
    aborted: deps.service.abortAgentRun(runId),
  };
}

/** First-class Goal API. Sessions are execution context; goals are durable product objects. */
export function registerGoalsRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const goals = new GoalService();
  const cfg = () => deps.service.currentConfig;
  const workflowRunService = deps.service.createWorkflowRunService();

  authenticated.get('/api/goals/current', async (c) => {
    const sessionKey = c.req.query('sessionKey')?.trim();
    if (!sessionKey) return c.json({ ok: false, error: 'Missing sessionKey' }, 400);
    return c.json({ ok: true, goal: goals.getActiveForSession(sessionKey) });
  });

  authenticated.get('/api/goals', async (c) => {
    const status = parseStatuses(c.req.query('status'));
    const agentId = c.req.query('agentId')?.trim() || undefined;
    const sessionKey = c.req.query('sessionKey')?.trim() || undefined;
    const limit = parseLimit(c.req.query('limit'));
    const offsetRaw = c.req.query('offset')?.trim();
    const offset = offsetRaw ? Math.max(0, Number.parseInt(offsetRaw, 10) || 0) : 0;
    return c.json({ ok: true, goals: goals.list({ status, agentId, sessionKey, limit, offset }) });
  });

  authenticated.get('/api/goals/queue', async (c) => {
    return c.json({ ok: true, queue: deps.service.getGoalQueueSnapshot() });
  });

  authenticated.post('/api/goals', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return c.json({ ok: false, error: 'Missing title' }, 400);

    const sessionKey = typeof body.sessionKey === 'string' && body.sessionKey.trim() ? body.sessionKey.trim() : undefined;
    const agentId =
      typeof body.agentId === 'string' && body.agentId.trim()
        ? body.agentId.trim()
        : sessionKey
          ? undefined
          : getDefaultAgentId(cfg());
    const maxTurns =
      typeof body.maxTurns === 'number' && Number.isFinite(body.maxTurns)
        ? Math.max(1, Math.min(500, Math.floor(body.maxTurns)))
        : undefined;
    const goal = goals.create({
      title,
      description: typeof body.description === 'string' ? body.description : undefined,
      sessionKey,
      agentId,
      priority: body.priority === 'low' || body.priority === 'high' ? body.priority : 'normal',
      deadlineAt: typeof body.deadlineAt === 'number' && Number.isFinite(body.deadlineAt) ? body.deadlineAt : undefined,
      judgeModelRef: typeof body.judgeModelRef === 'string' ? body.judgeModelRef : undefined,
      maxTurns,
      uiLocale: normalizeGoalUiLocale(body.uiLocale),
      source: body.source === 'cli' || body.source === 'cron' || body.source === 'workflow' || body.source === 'channel' || body.source === 'api'
        ? body.source
        : 'chat',
      config: cfg(),
    });

    if (sessionKey) {
      deps.service.enqueueWebchatPersistentGoalKickoff(sessionKey, title);
    }

    return c.json({ ok: true, goal: goals.get(goal.id) });
  });

  authenticated.get('/api/goals/:goalId/workflow-runs', async (c) => {
    const goalId = c.req.param('goalId');
    const goal = goals.get(goalId);
    if (!goal) return c.json({ ok: false, error: 'Goal not found' }, 404);
    const runStore = workflowRunService.createRunStore(goal.agentId || getDefaultAgentId(cfg()));
    const runs = await runStore.listRunSummariesForGoal(goalId, parseLimit(c.req.query('limit')));
    return c.json({ ok: true, runs });
  });

  authenticated.post('/api/goals/:goalId/workflows/run', async (c) => {
    const goalId = c.req.param('goalId');
    const goal = goals.get(goalId);
    if (!goal) return c.json({ ok: false, error: 'Goal not found' }, 404);
    if (goal.status === 'done' || goal.status === 'archived') {
      return c.json({ ok: false, error: `Goal is ${goal.status}` }, 409);
    }

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const definitionId = typeof body.definitionId === 'string' ? body.definitionId.trim() : '';
    if (!definitionId) return c.json({ ok: false, error: 'Missing definitionId' }, 400);

    try {
      createWorkflowCatalog().load(definitionId);
    } catch {
      return c.json({ ok: false, error: 'Workflow definition not found' }, 404);
    }

    const result = await workflowRunService.startWorkflowRun({
      agentId: goal.agentId || getDefaultAgentId(cfg()),
      definitionId,
      goalId,
      goal: typeof body.goal === 'string' && body.goal.trim() ? body.goal.trim() : goal.nextAction || goal.title,
      input: body.input ?? {
        goal: goal.title,
        description: goal.description,
        nextAction: goal.nextAction,
        checklist: goal.checklist.map((item) => ({
          text: item.text,
          status: item.status,
          evidenceSummary: item.evidenceSummary,
        })),
      },
      parentSessionKey: goal.activeSessionKey,
      source: { kind: 'webui' },
      concurrency: typeof body.concurrency === 'number' ? body.concurrency : undefined,
      maxSubagents: typeof body.maxSubagents === 'number' ? body.maxSubagents : undefined,
    });
    if (result.ok === false) {
      return c.json({ ok: false, error: result.message, code: result.code }, result.httpStatus);
    }
    return c.json({ ok: true, runId: result.runId, sessionKey: result.sessionKey }, 202);
  });

  authenticated.get('/api/goals/:goalId/activity', async (c) => {
    const goalId = c.req.param('goalId');
    const goal = goals.get(goalId);
    if (!goal) return c.json({ ok: false, error: 'Goal not found' }, 404);

    const limit = parseLimit(c.req.query('limit'), 100);
    const runStore = workflowRunService.createRunStore(goal.agentId || getDefaultAgentId(cfg()));
    const workflowRuns = await runStore.listRunSummariesForGoal(goalId, limit);
    const activities = buildGoalActivities({
      goalId,
      queue: deps.service.getGoalQueueSnapshot(),
      runs: goals.listRuns(goalId, limit),
      workflowRuns,
      events: goals.listEvents(goalId, limit),
      evidence: goals.listEvidence(goalId, limit),
      limit,
    });
    return c.json({ ok: true, activities });
  });

  authenticated.get('/api/goals/:goalId/workflow-suggestions', async (c) => {
    const goalId = c.req.param('goalId');
    const goal = goals.get(goalId);
    if (!goal) return c.json({ ok: false, error: 'Goal not found' }, 404);

    const runStore = workflowRunService.createRunStore(goal.agentId || getDefaultAgentId(cfg()));
    const workflowRuns = await runStore.listRunSummaries(500);
    return c.json({
      ok: true,
      suggestions: buildGoalWorkflowSuggestions({ goal, workflowRuns }),
    });
  });

  authenticated.get('/api/goals/:goalId', async (c) => {
    const goal = goals.get(c.req.param('goalId'));
    if (!goal) return c.json({ ok: false, error: 'Goal not found' }, 404);
    return c.json({ ok: true, goal });
  });

  authenticated.patch('/api/goals/:goalId', async (c) => {
    const goalId = c.req.param('goalId');
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const status = parseBodyGoalStatus(body.status);
    let goal = goals.get(goalId);
    if (!goal) return c.json({ ok: false, error: 'Goal not found' }, 404);
    const patch: Parameters<GoalService['update']>[1] = {};
    if (typeof body.title === 'string') patch.title = body.title;
    if ('description' in body) patch.description = typeof body.description === 'string' ? body.description : undefined;
    const priority = parsePriority(body.priority);
    if (priority) patch.priority = priority;
    if ('deadlineAt' in body) {
      patch.deadlineAt = typeof body.deadlineAt === 'number' && Number.isFinite(body.deadlineAt) ? body.deadlineAt : undefined;
    }
    if (typeof body.maxTurns === 'number' && Number.isFinite(body.maxTurns)) patch.maxTurns = body.maxTurns;
    if ('judgeModelRef' in body) patch.judgeModelRef = typeof body.judgeModelRef === 'string' ? body.judgeModelRef : undefined;
    if ('nextAction' in body) patch.nextAction = typeof body.nextAction === 'string' ? body.nextAction : undefined;
    if ('blockedReason' in body) patch.blockedReason = typeof body.blockedReason === 'string' ? body.blockedReason : undefined;
    const locale = normalizeGoalUiLocale(body.uiLocale);
    if (locale) patch.uiLocale = locale;
    if (Object.keys(patch).length > 0) {
      goal = goals.update(goalId, patch);
    }
    if (status) {
      const previousStatus = goal?.status;
      goal = goals.setStatus(goalId, status, {
        reason: typeof body.reason === 'string' ? body.reason : undefined,
      });
      const abortResult = goal && status === 'archived' ? abortActiveWebchatRunForGoal(deps, goal) : {};
      if (goal && previousStatus !== goal.status) {
        deps.service.emit('goal.status.updated', {
          goalId,
          previousStatus,
          status: goal.status,
          goal,
        });
      }
      return c.json({ ok: true, goal, ...abortResult });
    }
    return c.json({ ok: true, goal });
  });

  authenticated.post('/api/goals/:goalId/continue', async (c) => {
    const goalId = c.req.param('goalId');
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const goal = goals.get(goalId);
    if (!goal) return c.json({ ok: false, error: 'Goal not found' }, 404);
    let sessionKey =
      typeof body.sessionKey === 'string' && body.sessionKey.trim()
        ? body.sessionKey.trim()
        : goal.activeSessionKey;

    if (!sessionKey) {
      sessionKey = buildSessionKey({
        agentId: goal.agentId || getDefaultAgentId(cfg()),
        source: 'webchat',
        accountId: 'default',
        peerKind: 'direct',
        peerId: `goal-${sanitizeSegment(goal.id) || Date.now()}`,
      });
      await deps.service.sessionIndexInstance.saveMessages(sessionKey, []);
      goals.attachSession(goalId, sessionKey);
    }

    const queued = deps.service.enqueueGoalRun(goalId, {
      message: typeof body.message === 'string' ? body.message : undefined,
      maxRetries: typeof body.maxRetries === 'number' && Number.isFinite(body.maxRetries) ? body.maxRetries : undefined,
      source: 'api',
    });
    const nextGoal = goals.get(goalId);
    return c.json({ ok: true, goal: nextGoal, sessionKey, queued });
  });

  authenticated.post('/api/goals/:goalId/enqueue', async (c) => {
    const goalId = c.req.param('goalId');
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!goals.get(goalId)) return c.json({ ok: false, error: 'Goal not found' }, 404);
    const item = deps.service.enqueueGoalRun(goalId, {
      message: typeof body.message === 'string' ? body.message : undefined,
      maxRetries: typeof body.maxRetries === 'number' && Number.isFinite(body.maxRetries) ? body.maxRetries : undefined,
      source: 'api',
    });
    return c.json({ ok: true, item });
  });

  authenticated.post('/api/goals/:goalId/pause', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const before = goals.get(c.req.param('goalId'));
    const goal = goals.pause(
      c.req.param('goalId'),
      typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'user-paused',
    );
    if (!goal) return c.json({ ok: false, error: 'Goal not found' }, 404);
    if (before?.status !== goal.status) {
      deps.service.emit('goal.status.updated', {
        goalId: goal.id,
        previousStatus: before?.status,
        status: goal.status,
        goal,
      });
    }
    return c.json({ ok: true, goal });
  });

  authenticated.post('/api/goals/:goalId/resume', async (c) => {
    const before = goals.get(c.req.param('goalId'));
    const goal = goals.resume(c.req.param('goalId'));
    if (!goal) return c.json({ ok: false, error: 'Goal not found' }, 404);
    if (before?.status !== goal.status) {
      deps.service.emit('goal.status.updated', {
        goalId: goal.id,
        previousStatus: before?.status,
        status: goal.status,
        goal,
      });
    }
    return c.json({ ok: true, goal });
  });

  authenticated.post('/api/goals/:goalId/reopen', async (c) => {
    const before = goals.get(c.req.param('goalId'));
    const goal = goals.reopen(c.req.param('goalId'));
    if (!goal) return c.json({ ok: false, error: 'Goal not found' }, 404);
    if (before?.status !== goal.status) {
      deps.service.emit('goal.status.updated', {
        goalId: goal.id,
        previousStatus: before?.status,
        status: goal.status,
        goal,
      });
    }
    return c.json({ ok: true, goal });
  });

  authenticated.post('/api/goals/:goalId/complete', async (c) => {
    const before = goals.get(c.req.param('goalId'));
    const goal = goals.complete(c.req.param('goalId'));
    if (!goal) return c.json({ ok: false, error: 'Goal not found' }, 404);
    if (before?.status !== goal.status) {
      deps.service.emit('goal.status.updated', {
        goalId: goal.id,
        previousStatus: before?.status,
        status: goal.status,
        goal,
      });
    }
    return c.json({ ok: true, goal });
  });

  authenticated.post('/api/goals/:goalId/archive', async (c) => {
    const before = goals.get(c.req.param('goalId'));
    const goal = goals.archive(c.req.param('goalId'));
    if (!goal) return c.json({ ok: false, error: 'Goal not found' }, 404);
    const abortResult = abortActiveWebchatRunForGoal(deps, goal);
    if (before?.status !== goal.status) {
      deps.service.emit('goal.status.updated', {
        goalId: goal.id,
        previousStatus: before?.status,
        status: goal.status,
        goal,
      });
    }
    return c.json({ ok: true, goal, ...abortResult });
  });

  authenticated.post('/api/goals/:goalId/unarchive', async (c) => {
    const before = goals.get(c.req.param('goalId'));
    const goal = goals.unarchive(c.req.param('goalId'));
    if (!goal) return c.json({ ok: false, error: 'Goal not found' }, 404);
    if (before?.status !== goal.status) {
      deps.service.emit('goal.status.updated', {
        goalId: goal.id,
        previousStatus: before?.status,
        status: goal.status,
        goal,
      });
    }
    return c.json({ ok: true, goal });
  });

  authenticated.post('/api/goals/:goalId/attach', async (c) => {
    const goalId = c.req.param('goalId');
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : '';
    if (!sessionKey) return c.json({ ok: false, error: 'Missing sessionKey' }, 400);
    const goal = goals.attachSession(goalId, sessionKey);
    if (!goal) return c.json({ ok: false, error: 'Goal not found' }, 404);
    return c.json({ ok: true, goal });
  });

  authenticated.post('/api/goals/:goalId/detach', async (c) => {
    const goal = goals.update(c.req.param('goalId'), { activeSessionKey: undefined });
    if (!goal) return c.json({ ok: false, error: 'Goal not found' }, 404);
    return c.json({ ok: true, goal });
  });

  authenticated.get('/api/goals/:goalId/runs', async (c) => {
    const goalId = c.req.param('goalId');
    if (!goals.get(goalId)) return c.json({ ok: false, error: 'Goal not found' }, 404);
    return c.json({ ok: true, runs: goals.listRuns(goalId, parseLimit(c.req.query('limit'))) });
  });

  authenticated.get('/api/goals/:goalId/events', async (c) => {
    const goalId = c.req.param('goalId');
    if (!goals.get(goalId)) return c.json({ ok: false, error: 'Goal not found' }, 404);
    return c.json({ ok: true, events: goals.listEvents(goalId, parseLimit(c.req.query('limit'), 100)) });
  });

  authenticated.get('/api/goals/:goalId/evidence', async (c) => {
    const goalId = c.req.param('goalId');
    if (!goals.get(goalId)) return c.json({ ok: false, error: 'Goal not found' }, 404);
    return c.json({ ok: true, evidence: goals.listEvidence(goalId, parseLimit(c.req.query('limit'), 100)) });
  });

  authenticated.post('/api/goals/:goalId/evidence', async (c) => {
    const goalId = c.req.param('goalId');
    if (!goals.get(goalId)) return c.json({ ok: false, error: 'Goal not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const kind = body.kind;
    if (!title) return c.json({ ok: false, error: 'Missing title' }, 400);
    if (kind !== 'file' && kind !== 'diff' && kind !== 'command' && kind !== 'test' && kind !== 'link' && kind !== 'message' && kind !== 'artifact') {
      return c.json({ ok: false, error: 'Invalid evidence kind' }, 400);
    }
    const evidence = goals.addEvidence({
      goalId,
      runId: typeof body.runId === 'string' ? body.runId : undefined,
      kind,
      title,
      summary: typeof body.summary === 'string' ? body.summary : undefined,
      uri: typeof body.uri === 'string' ? body.uri : undefined,
      data: body.data,
    });
    return c.json({ ok: true, evidence });
  });

  authenticated.post('/api/goals/:goalId/checklist', async (c) => {
    const goalId = c.req.param('goalId');
    if (!goals.get(goalId)) return c.json({ ok: false, error: 'Goal not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return c.json({ ok: false, error: 'Missing text' }, 400);
    const goal = goals.updateChecklist(goalId, { type: 'add', text, addedBy: 'user' });
    return c.json({ ok: true, goal });
  });

  authenticated.patch('/api/goals/:goalId/checklist/:itemId', async (c) => {
    const goalId = c.req.param('goalId');
    const itemId = c.req.param('itemId');
    if (!goals.get(goalId)) return c.json({ ok: false, error: 'Goal not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const status = body.status;
    if (status !== 'pending' && status !== 'completed' && status !== 'impossible') {
      return c.json({ ok: false, error: 'Invalid checklist status' }, 400);
    }
    const goal = goals.updateChecklist(goalId, {
      type: 'mark',
      itemId,
      status,
      evidenceSummary: typeof body.evidenceSummary === 'string' ? body.evidenceSummary : undefined,
    });
    return c.json({ ok: true, goal });
  });

  authenticated.delete('/api/goals/:goalId/checklist/:itemId', async (c) => {
    const goalId = c.req.param('goalId');
    if (!goals.get(goalId)) return c.json({ ok: false, error: 'Goal not found' }, 404);
    const goal = goals.updateChecklist(goalId, { type: 'remove', itemId: c.req.param('itemId') });
    return c.json({ ok: true, goal });
  });
}
