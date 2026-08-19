import type { Hono } from 'hono';

import {
  findExecutionReceiptForAssistant,
  listExecutionReceipts,
  setExecutionVerdict,
  summarizeExecutionReceipts,
  setExecutionReceiptFeedbackByRunId,
  updateExecutionReceipt,
  type ExecutionContract,
  type ExecutionEvidence,
} from '../../../storage/sqlite/index.js';
import { TaskReceiptService } from '../../../tasks/task-receipt-service.js';
import { TaskProjectionService } from '../../../tasks/task-projection-service.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { replayExecutionEvaluation } from '../../../agent/tasks/execution-evaluation.js';
import { recordTaskContextFeedback } from '../../../tasks/task-context-feedback.js';
import { TaskController } from '../../../tasks/task-controller.js';

function parseLimit(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isExecutionContract(value: unknown): value is ExecutionContract {
  if (!value || typeof value !== 'object') return false;
  const contract = value as Partial<ExecutionContract>;
  return typeof contract.objective === 'string'
    && isStringArray(contract.expectedOutputs)
    && isStringArray(contract.acceptanceCriteria)
    && isStringArray(contract.constraints)
    && isStringArray(contract.approvalRequired)
    && isStringArray(contract.assumptions)
    && isStringArray(contract.risks);
}

function isExecutionEvidence(value: unknown): value is ExecutionEvidence[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const evidence = item as Partial<ExecutionEvidence>;
    return (evidence.kind === 'artifact'
      || evidence.kind === 'test'
      || evidence.kind === 'state'
      || evidence.kind === 'source')
      && typeof evidence.title === 'string'
      && typeof evidence.summary === 'string'
      && (evidence.uri === undefined || typeof evidence.uri === 'string')
      && (evidence.verifies === undefined || isStringArray(evidence.verifies))
      && (evidence.provenance === 'tool'
        || evidence.provenance === 'external'
        || evidence.provenance === 'user'
        || evidence.provenance === 'judge')
      && (evidence.strength === 'observed' || evidence.strength === 'verified')
      && typeof evidence.observedAt === 'number'
      && Number.isFinite(evidence.observedAt);
  });
}

export function registerExecutionReceiptRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const receipts = new TaskReceiptService();
  const projections = new TaskProjectionService();
  const controller = new TaskController({
    enqueue: (taskId, options) => deps.service.enqueueTask(taskId, options),
  });

  authenticated.get('/api/execution-receipts', (c) => {
    const items = receipts.list({
      sessionKey: c.req.query('sessionKey')?.trim() || undefined,
      projectId: c.req.query('projectId')?.trim() || undefined,
      limit: parseLimit(c.req.query('limit')),
    });
    return c.json({ ok: true, items });
  });

  authenticated.get('/api/execution-receipts/metrics', (c) => {
    return c.json({ ok: true, metrics: summarizeExecutionReceipts() });
  });

  authenticated.get('/api/execution-receipts/evaluation', (c) => {
    const items = listExecutionReceipts({ limit: parseLimit(c.req.query('limit')) ?? 100 });
    return c.json({ ok: true, evaluation: replayExecutionEvaluation(items) });
  });

  authenticated.get('/api/execution-receipts/for-assistant', (c) => {
    const sessionKey = c.req.query('sessionKey')?.trim() ?? '';
    const assistantTimestamp = Number(c.req.query('assistantTimestamp'));
    if (!sessionKey || !Number.isFinite(assistantTimestamp) || assistantTimestamp <= 0) {
      return c.json({ ok: false, error: 'sessionKey and assistantTimestamp are required' }, 400);
    }
    const receipt = findExecutionReceiptForAssistant(sessionKey, assistantTimestamp);
    return receipt
      ? c.json({ ok: true, receipt })
      : c.json({ ok: false, error: 'Execution receipt not found' }, 404);
  });

  authenticated.get('/api/execution-receipts/:runId', (c) => {
    const receipt = receipts.get(c.req.param('runId'));
    return receipt
      ? c.json({ ok: true, receipt })
      : c.json({ ok: false, error: 'Execution receipt not found' }, 404);
  });

  authenticated.patch('/api/execution-receipts/:runId', async (c) => {
    const body = await c.req.json().catch(() => null) as {
      contract?: ExecutionContract;
      evidence?: ExecutionEvidence[];
      summary?: string;
    } | null;
    if (!body || typeof body !== 'object') {
      return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
    }
    if (body.contract !== undefined && !isExecutionContract(body.contract)) {
      return c.json({ ok: false, error: 'Invalid execution contract' }, 400);
    }
    if (body.evidence !== undefined && !isExecutionEvidence(body.evidence)) {
      return c.json({ ok: false, error: 'Invalid execution evidence' }, 400);
    }
    if (body.summary !== undefined && typeof body.summary !== 'string') {
      return c.json({ ok: false, error: 'Invalid execution summary' }, 400);
    }
    const receipt = updateExecutionReceipt({
      runId: c.req.param('runId'),
      ...(body.contract === undefined ? {} : { contract: body.contract }),
      ...(body.evidence === undefined ? {} : { evidence: body.evidence }),
      ...(body.summary === undefined ? {} : { summary: body.summary }),
    });
    if (!receipt) return c.json({ ok: false, error: 'Execution receipt not found' }, 404);
    const projected = receipt.status === 'running' ? receipt : projections.project(receipt);
    return c.json({ ok: true, receipt: receipts.get(projected.runId) });
  });

  authenticated.post('/api/execution-receipts/:runId/feedback', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const feedback = body.rating === 'helpful' || body.rating === 'not_helpful' ? body.rating : undefined;
    if (!feedback) return c.json({ ok: false, error: 'rating must be helpful or not_helpful' }, 400);
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 2_000) : undefined;
    let receipt = setExecutionReceiptFeedbackByRunId({
      runId: c.req.param('runId'),
      rating: feedback,
      reason: reason || undefined,
      needsCorrection: feedback === 'not_helpful',
      supportFit: typeof body.supportFit === 'boolean' ? body.supportFit : undefined,
    });
    if (!receipt) return c.json({ ok: false, error: 'Task receipt not found' }, 404);
    if (feedback === 'not_helpful' && receipt.status !== 'running') {
      receipt = setExecutionVerdict({
        runId: receipt.runId,
        verdict: 'not_achieved',
        correctionText: reason || 'The user reported that the task was not completed correctly.',
      }) ?? receipt;
      const projected = projections.project(receipt);
      recordTaskContextFeedback(projected);
      controller.handleCompletedRun(projected);
    }
    return c.json({ ok: true, receipt: receipts.get(receipt.runId) });
  });

  authenticated.post('/api/execution-receipts/:runId/verdict', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const verdict = body?.verdict;
    if (verdict !== 'achieved' && verdict !== 'partial' && verdict !== 'not_achieved') {
      return c.json({ ok: false, error: 'verdict must be achieved, partial, or not_achieved' }, 400);
    }
    const correctionText = typeof body?.correctionText === 'string'
      ? body.correctionText.trim().slice(0, 2_000)
      : undefined;
    const receipt = setExecutionVerdict({
      runId: c.req.param('runId'),
      verdict,
      correctionText: correctionText || undefined,
    });
    if (!receipt) return c.json({ ok: false, error: 'Completed execution receipt not found' }, 404);
    const projected = projections.project(receipt);
    recordTaskContextFeedback(projected);
    controller.handleCompletedRun(projected);
    return c.json({ ok: true, receipt: receipts.get(projected.runId) });
  });
}
