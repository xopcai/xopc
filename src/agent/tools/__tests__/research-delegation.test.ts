import { Type } from '@sinclair/typebox';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const embedded = vi.hoisted(() => ({ child: vi.fn() }));
vi.mock('../../child-agent-factory.js', () => ({ createDelegateChildHandle: embedded.child }));

import { createDelegateTool } from '../delegate-tool.js';
import { closeXopcDatabase, ensureSessionRecord, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { getResearchCheckpoint } from '../../../storage/sqlite/research-checkpoint-repository.js';

const conversationId = 'aabf5ef6-72f6-4d10-8127-43ae78e9449e';
const workspace = '/tmp/research';
const finding = { id: 'price', subject: 'Vendor', field: 'price', status: 'not_disclosed', conclusion: 'Contact sales', sources: [] };
const result = (stopReason: string, status = 'partial') => ({ summary: 'Collected source evidence', status, stopReason,
  toolIterations: 2, budget: { tier: 'standard', usage: {}, limits: {} }, handoff: { requested: true, completed: true } });
function tool(owner = conversationId, allowed = ['web_fetch']) {
  return createDelegateTool({ workspace, getCurrentContext: () => ({ conversationId: owner }), getConfig: () => undefined,
    getSubagentModel: () => ({ id: 'test', provider: 'openai' }) as any, bus: {} as any,
    getParentTools: () => allowed.map(name => ({ name, label: name, description: name, parameters: Type.Object({}), execute: vi.fn() })), buildChildTools: () => [],
  });
}
describe('research delegation resume', () => {
  beforeEach(() => {
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' });
    ensureSessionRecord(conversationId, workspace, { agentId: 'main' });
    embedded.child.mockReset();
  });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });
  it('continues budget exhaustion from saved findings and bounds automatic attempts', async () => {
    embedded.child.mockImplementation(options => ({ abort() {}, run: async () => {
      options.researchCheckpoint.save({ findings: [finding], nextSteps: ['Check concurrency'] });
      return result('deadline_exceeded');
    } }));
    const output = await tool().execute('research', { goal: 'Research Vendor', maxAttempts: 2 });
    expect(embedded.child).toHaveBeenCalledTimes(2);
    expect(embedded.child.mock.calls[1]![0].context).toContain('Contact sales');
    expect(embedded.child.mock.calls[1]![0].context).toContain('Check concurrency');
    expect(output.details).toMatchObject({ status: 'partial', attempts: 2, totalAttempts: 2, checkpoint: { findings: [expect.objectContaining({ id: 'price' })] } });
    expect(getResearchCheckpoint(output.details.resumeId, conversationId, workspace)?.status).toBe('partial');
  });
  it('resumes across calls, rechecks current access and returns completed research without rerunning', async () => {
    embedded.child.mockImplementationOnce(options => ({ abort() {}, run: async () => {
      options.researchCheckpoint.save({ findings: [finding], nextSteps: ['Check concurrency'] });
      return result('deadline_exceeded');
    } })).mockImplementationOnce(options => ({ abort() {}, run: async () => {
      expect(options.allowedToolNames).toEqual(['knowledge_get']);
      expect(options.context).toContain('Check concurrency');
      options.researchCheckpoint.save({ findings: [], nextSteps: [] });
      return result('completed', 'success');
    } }));
    const first = await tool().execute('first', { goal: 'Research Vendor', maxAttempts: 1 });
    const input = { goal: 'Research Vendor', resumeId: first.details.resumeId };
    expect((await tool(conversationId, ['knowledge_get']).execute('resume', input)).details.status).toBe('success');
    expect((await tool().execute('again', input)).details.status).toBe('success');
    expect(embedded.child).toHaveBeenCalledTimes(2);
    await expect(tool('other-conversation').execute('foreign', input)).rejects.toThrow('not found');
    await expect(tool().execute('changed', { ...input, goal: 'Different goal' })).rejects.toThrow('original goal');
  });
  it.each(['parent_policy', 'credit_budget', 'provider_error', 'parent_cancelled'])('never automatically retries %s', async reason => {
    embedded.child.mockImplementation(() => ({ abort() {}, run: async () => result(reason, reason === 'parent_cancelled' ? 'cancelled' : 'failed') }));
    await tool().execute('research', { goal: 'Research', maxAttempts: 3 });
    expect(embedded.child).toHaveBeenCalledTimes(1);
  });
  it('does not accept a final text response as a saved complete result', async () => {
    embedded.child.mockImplementation(() => ({ abort() {}, run: async () => result('completed', 'success') }));
    const output = await tool().execute('research', { goal: 'Research' });
    expect(output.details).toMatchObject({ status: 'partial', stopReason: 'verification' });
    expect(embedded.child).toHaveBeenCalledTimes(1);
  });
  it('preserves newly saved results when the runner throws', async () => {
    embedded.child.mockImplementation(options => ({ abort() {}, run: async () => {
      options.researchCheckpoint.save({ findings: [finding], nextSteps: ['Check concurrency'] });
      throw new Error('Provider disconnected');
    } }));
    const output = await tool().execute('research', { goal: 'Research' });
    expect(output.details).toMatchObject({ status: 'failed', checkpoint: { findings: [expect.objectContaining({ id: 'price' })] } });
    expect(getResearchCheckpoint(output.details.resumeId, conversationId, workspace)?.checkpoint.findings).toHaveLength(1);
  });
});
