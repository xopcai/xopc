import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ complete: vi.fn(), write: vi.fn() }));
vi.mock('../../providers/model-call.js', () => ({ completeWithResolvedCredentials: mocks.complete }));
vi.mock('../../providers/index.js', () => ({ resolveModel: () => ({ id: 'model', provider: 'test' }) }));
vi.mock('../../config/schema.js', () => ({ getAgentDefaultModelRef: () => 'test/model' }));
vi.mock('../../storage/sqlite/transaction.js', () => ({ getSqliteDatabase: () => ({ prepare: () => ({ get: () => undefined, run: mocks.write }) }) }));

import { analyzeDiscussion } from '../analyzer.js';
import { isTransientProcessingError } from '../processing.js';

const input = { config: {} as never, discussionId: 'capture', transcript: 'Source text', segments: [{
  sequence: 0, displayText: 'Source text', startedAtMs: 0, endedAtMs: 1_000,
}] as never };
const valid = { title: 'Meeting', summary: 'Summary', keyPoints: [], decisions: [], actionItems: [], risks: [], openQuestions: [] };
beforeEach(() => { vi.clearAllMocks(); });

describe('discussion model failures', () => {
  it('surfaces SDK error messages instead of hiding a temporary model failure behind a JSON parse error', async () => {
    mocks.complete.mockResolvedValue({ errorMessage: '503 Service Unavailable', stopReason: 'error', content: [] });
    const error = await analyzeDiscussion(input).catch(error => error);
    expect(error.message).toContain('503 Service Unavailable'); expect(isTransientProcessingError(error)).toBe(true);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('preserves authentication failures so the scheduler does not automatically retry invalid keys', async () => {
    mocks.complete.mockResolvedValue({ errorMessage: '401 Unauthorized: invalid API key', stopReason: 'error', content: [] });
    const error = await analyzeDiscussion(input).catch(error => error);
    expect(error.message).toContain('invalid API key'); expect(isTransientProcessingError(error)).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('retries the connection error returned by the real model SDK after a transport disconnection', async () => {
    mocks.complete.mockResolvedValue({ errorMessage: 'Connection error.', stopReason: 'error', content: [] });
    const error = await analyzeDiscussion(input).catch(error => error);
    expect(error.message).toContain('Connection error.'); expect(isTransientProcessingError(error)).toBe(true);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('does not cache truncated JSON output as a complete chapter even when the JSON is syntactically valid', async () => {
    mocks.complete.mockResolvedValue({ stopReason: 'length', content: [{ type: 'text', text: JSON.stringify(valid) }] });
    await expect(analyzeDiscussion(input)).rejects.toThrow('truncated'); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('does not cache malformed output, allowing a later attempt to generate a valid chapter', async () => {
    mocks.complete.mockResolvedValueOnce({ stopReason: 'stop', content: [{ type: 'text', text: '{broken' }] })
      .mockResolvedValueOnce({ stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify(valid) }] });
    await expect(analyzeDiscussion(input)).rejects.toThrow(); expect(mocks.write).not.toHaveBeenCalled();
    expect((await analyzeDiscussion(input)).organization.summary).toBe('Summary'); expect(mocks.write).toHaveBeenCalledOnce();
  });
  it('releases a model call that ignores its abort signal without caching a late result', async () => {
    let finish!: (value: unknown) => void;
    mocks.complete.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const task = analyzeDiscussion({ ...input, signal: controller.signal }).catch(error => error);
    await vi.waitFor(() => expect(mocks.complete).toHaveBeenCalledOnce());
    controller.abort(new Error('Gateway stopped'));
    expect((await task).message).toBe('Gateway stopped');
    finish({ stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify(valid) }] });
    await Promise.resolve(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each([
    ['provider_error', true],
    ['timeout', true],
    ['not_configured', false],
  ])('uses STT failure reason %s when deciding automatic recovery', (reasonCode, retryable) => {
    const error = Object.assign(new Error('STT request failed'), { reasonCode });
    expect(isTransientProcessingError(error)).toBe(retryable);
  });

});
