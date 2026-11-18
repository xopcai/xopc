import type { TaskRunReceipt } from '@xopcai/gateway-contract';
import { describe, expect, it } from 'vitest';

import { presentTaskRunResult, taskTextForDisplay } from '../task-result-presentation';

const receipt: TaskRunReceipt = {
  runId: 'run', status: 'succeeded', summary: '', finalizedAt: 1, needsUser: false,
  changes: [], evidence: [], remainingWork: [], verification: { status: 'unverified', checks: [] },
};

describe('task result presentation', () => {
  it('preserves real output that contains status-like numbers or is valid JSON', () => {
    const count = '429 records matched the query.';
    const data = '{"kind":"report","message":"Inventory complete","count":429}';
    expect(taskTextForDisplay(count, 'en')).toBe(count);
    expect(presentTaskRunResult({ ...receipt, summary: data }, 'en')).toMatchObject({ summary: data, issue: undefined });
  });

  it('keeps a usable partial result and the concrete missing file after an acceptance failure', () => {
    const result = presentTaskRunResult({
      ...receipt, status: 'failed', summary: '整理了三条新闻，附有来源链接。', completionVerdict: 'partial',
      remainingWork: ['Published file missing: 新闻简报.html. Republish from the existing workspace output.'],
      failure: { code: 'acceptance_incomplete', phase: 'execution', recoveryAction: 'Inspect gaps and retry' },
    }, 'zh');
    expect(result).toMatchObject({
      issue: { title: '结果尚未达到验收要求' },
      summary: '整理了三条新闻，附有来源链接。',
      remainingWork: ['暂时无法打开交付文件「新闻简报.html」，需要重新发布。'],
    });
  });

  it('gives unconfirmed external changes priority over retry guidance from an error', () => {
    const result = presentTaskRunResult({
      ...receipt, status: 'failed',
      summary: '{"kind":"timeout","code":"timeout","message":"Request timed out"}',
      failure: { code: 'tool_outcome_unconfirmed', phase: 'execution', recoveryAction: 'Confirm the outcome' },
    }, 'en');
    expect(result.issue?.description).toBe('Before retrying, check whether the previous run made any external changes.');
    expect(result.summary).toBe('');
  });
});
