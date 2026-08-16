import type { Hono } from 'hono';

import {
  getTaskOutcome,
  findTaskOutcomeForAssistant,
  listTaskOutcomes,
  setTaskCompletionVerdict,
  summarizeTaskOutcomes,
  setTaskOutcomeFeedbackByRunId,
  updateTaskOutcome,
  type TaskContract,
  type TaskEvidence,
} from '../../../storage/sqlite/index.js';
import { OutcomeReceiptService } from '../../../work/outcome-receipt-service.js';
import { OutcomeProjectionService } from '../../../work/outcome-projection-service.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { replayTaskEvaluation } from '../../../agent/outcomes/task-evaluation.js';

function parseLimit(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isTaskContract(value: unknown): value is TaskContract {
  if (!value || typeof value !== 'object') return false;
  const contract = value as Partial<TaskContract>;
  return typeof contract.objective === 'string'
    && isStringArray(contract.deliverables)
    && isStringArray(contract.acceptanceCriteria)
    && isStringArray(contract.constraints)
    && isStringArray(contract.approvalRequired);
}

function isTaskEvidence(value: unknown): value is TaskEvidence[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const evidence = item as Partial<TaskEvidence>;
    return (evidence.kind === 'artifact'
      || evidence.kind === 'test'
      || evidence.kind === 'state'
      || evidence.kind === 'source')
      && typeof evidence.title === 'string'
      && typeof evidence.summary === 'string'
      && (evidence.uri === undefined || typeof evidence.uri === 'string')
      && (evidence.verifies === undefined || isStringArray(evidence.verifies));
  });
}

export function registerTaskOutcomeRoutes(authenticated: Hono, _deps: AuthenticatedRouteDeps): void {
  const receipts = new OutcomeReceiptService();
  const projections = new OutcomeProjectionService();

  authenticated.get('/api/task-outcomes', (c) => {
    const items = listTaskOutcomes({
      sessionKey: c.req.query('sessionKey')?.trim() || undefined,
      projectId: c.req.query('projectId')?.trim() || undefined,
      workItemId: c.req.query('workItemId')?.trim() || undefined,
      limit: parseLimit(c.req.query('limit')),
    });
    return c.json({ ok: true, items });
  });

  authenticated.get('/api/task-outcomes/metrics', (c) => {
    return c.json({ ok: true, metrics: summarizeTaskOutcomes() });
  });

  authenticated.get('/api/task-outcomes/evaluation', (c) => {
    const items = listTaskOutcomes({ limit: parseLimit(c.req.query('limit')) ?? 100 });
    return c.json({ ok: true, evaluation: replayTaskEvaluation(items) });
  });

  authenticated.get('/api/task-outcomes/for-assistant', (c) => {
    const sessionKey = c.req.query('sessionKey')?.trim() ?? '';
    const assistantTimestamp = Number(c.req.query('assistantTimestamp'));
    if (!sessionKey || !Number.isFinite(assistantTimestamp) || assistantTimestamp <= 0) {
      return c.json({ ok: false, error: 'sessionKey and assistantTimestamp are required' }, 400);
    }
    const outcome = findTaskOutcomeForAssistant(sessionKey, assistantTimestamp);
    return outcome
      ? c.json({ ok: true, outcome })
      : c.json({ ok: false, error: 'Task outcome not found' }, 404);
  });

  authenticated.get('/api/task-outcomes/:runId', (c) => {
    const outcome = getTaskOutcome(c.req.param('runId'));
    return outcome
      ? c.json({ ok: true, outcome })
      : c.json({ ok: false, error: 'Task outcome not found' }, 404);
  });

  authenticated.patch('/api/task-outcomes/:runId', async (c) => {
    const body = await c.req.json().catch(() => null) as {
      contract?: TaskContract;
      evidence?: TaskEvidence[];
      summary?: string;
    } | null;
    if (!body || typeof body !== 'object') {
      return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
    }
    if (body.contract !== undefined && !isTaskContract(body.contract)) {
      return c.json({ ok: false, error: 'Invalid task contract' }, 400);
    }
    if (body.evidence !== undefined && !isTaskEvidence(body.evidence)) {
      return c.json({ ok: false, error: 'Invalid task evidence' }, 400);
    }
    if (body.summary !== undefined && typeof body.summary !== 'string') {
      return c.json({ ok: false, error: 'Invalid task summary' }, 400);
    }
    const outcome = updateTaskOutcome({
      runId: c.req.param('runId'),
      ...(body.contract === undefined ? {} : { contract: body.contract }),
      ...(body.evidence === undefined ? {} : { evidence: body.evidence }),
      ...(body.summary === undefined ? {} : { summary: body.summary }),
    });
    if (!outcome) return c.json({ ok: false, error: 'Task outcome not found' }, 404);
    const projected = outcome.status === 'running' ? outcome : projections.project(outcome);
    return c.json({ ok: true, outcome: projected });
  });

  authenticated.get('/api/work/outcomes', (c) => {
    const items = receipts.list({
      projectId: c.req.query('projectId')?.trim() || undefined,
      workItemId: c.req.query('workItemId')?.trim() || undefined,
      sessionKey: c.req.query('sessionKey')?.trim() || undefined,
      limit: parseLimit(c.req.query('limit')),
    });
    return c.json({ ok: true, items });
  });

  authenticated.get('/api/work/outcomes/:runId', (c) => {
    const receipt = receipts.get(c.req.param('runId'));
    return receipt
      ? c.json({ ok: true, receipt })
      : c.json({ ok: false, error: 'Outcome receipt not found' }, 404);
  });

  authenticated.post('/api/work/outcomes/:runId/feedback', _deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const feedback = body.outcome === 'helpful' || body.outcome === 'not_helpful' ? body.outcome : undefined;
    if (!feedback) return c.json({ ok: false, error: 'outcome must be helpful or not_helpful' }, 400);
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 160) : undefined;
    const outcome = setTaskOutcomeFeedbackByRunId({
      runId: c.req.param('runId'),
      outcome: feedback,
      reason: reason || undefined,
      needsCorrection: feedback === 'not_helpful',
      supportFit: typeof body.supportFit === 'boolean' ? body.supportFit : undefined,
    });
    return outcome
      ? c.json({ ok: true, receipt: receipts.get(outcome.runId) })
      : c.json({ ok: false, error: 'Outcome receipt not found' }, 404);
  });

  authenticated.post('/api/work/outcomes/:runId/verdict', _deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const verdict = body?.verdict;
    if (verdict !== 'achieved' && verdict !== 'partial' && verdict !== 'not_achieved') {
      return c.json({ ok: false, error: 'verdict must be achieved, partial, or not_achieved' }, 400);
    }
    const correctionText = typeof body?.correctionText === 'string'
      ? body.correctionText.trim().slice(0, 2_000)
      : undefined;
    const outcome = setTaskCompletionVerdict({
      runId: c.req.param('runId'),
      verdict,
      correctionText: correctionText || undefined,
    });
    if (!outcome) return c.json({ ok: false, error: 'Completed outcome not found' }, 404);
    const projected = projections.project(outcome);
    return c.json({ ok: true, receipt: receipts.get(projected.runId) });
  });
}
