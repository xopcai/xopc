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
import { OutcomeReceiptService } from '../../../work/outcome-receipt-service.js';
import { OutcomeProjectionService } from '../../../work/outcome-projection-service.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { replayExecutionEvaluation } from '../../../agent/outcomes/execution-evaluation.js';

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
    && isStringArray(contract.deliverables)
    && isStringArray(contract.acceptanceCriteria)
    && isStringArray(contract.constraints)
    && isStringArray(contract.approvalRequired);
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
      && (evidence.verifies === undefined || isStringArray(evidence.verifies));
  });
}

export function registerExecutionReceiptRoutes(authenticated: Hono, _deps: AuthenticatedRouteDeps): void {
  const receipts = new OutcomeReceiptService();
  const projections = new OutcomeProjectionService();

  authenticated.get('/api/execution-receipts', (c) => {
    const items = receipts.list({
      sessionKey: c.req.query('sessionKey')?.trim() || undefined,
      projectId: c.req.query('projectId')?.trim() || undefined,
      workItemId: c.req.query('workItemId')?.trim() || undefined,
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

  authenticated.post('/api/execution-receipts/:runId/feedback', _deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const feedback = body.outcome === 'helpful' || body.outcome === 'not_helpful' ? body.outcome : undefined;
    if (!feedback) return c.json({ ok: false, error: 'outcome must be helpful or not_helpful' }, 400);
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 160) : undefined;
    const receipt = setExecutionReceiptFeedbackByRunId({
      runId: c.req.param('runId'),
      outcome: feedback,
      reason: reason || undefined,
      needsCorrection: feedback === 'not_helpful',
      supportFit: typeof body.supportFit === 'boolean' ? body.supportFit : undefined,
    });
    return receipt
      ? c.json({ ok: true, receipt: receipts.get(receipt.runId) })
      : c.json({ ok: false, error: 'Outcome receipt not found' }, 404);
  });

  authenticated.post('/api/execution-receipts/:runId/verdict', _deps.strictRateLimitMiddleware, async (c) => {
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
    return c.json({ ok: true, receipt: receipts.get(projected.runId) });
  });
}
