// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ storage: new Map<string, unknown>(), fetch: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ apiFetch: state.fetch }));
vi.mock('@/stores/gateway-store', () => ({ useGatewayStore: { getState: () => ({ baseUrl: 'http://localhost', conversationId: 'account' }) } }));
vi.mock('./clarification-draft-storage', () => ({ clarificationDraftStorage: (id: string, version: number, category: string) => {
  const key = `${id}:${version}:${category}`;
  return { read: async () => state.storage.get(key), write: async (value: unknown) => { if (value === undefined) state.storage.delete(key); else state.storage.set(key, value); } };
} }));
import { submitQuestionBatch } from './clarification-submission';
beforeEach(() => { state.storage.clear(); state.fetch.mockReset(); });
const submission = { schemaVersion: 2 as const, answers: [{ questionId: 'q', text: 'Answer' }] };
it('coalesces concurrent clicks before asynchronous persistence completes', async () => {
  state.fetch.mockResolvedValue(new Response('{}', { status: 202 }));
  const replies = await Promise.all([submitQuestionBatch('w1', 1, 'answer', submission), submitQuestionBatch('w1', 1, 'answer', submission)]);
  expect(state.fetch).toHaveBeenCalledOnce();
  expect(await replies[0].json()).toEqual({});
  expect(await replies[1].json()).toEqual({});
  await submitQuestionBatch('w1', 1, 'answer', submission);
  expect(state.fetch).toHaveBeenCalledOnce();
});
it('retains the original identity across an uncertain result and rejects changes', async () => {
  state.fetch.mockRejectedValueOnce(new Error('Network disconnected')).mockResolvedValueOnce(new Response('{}', { status: 202 }));
  await expect(submitQuestionBatch('w2', 1, 'answer', submission)).rejects.toThrow('Network disconnected');
  await expect(submitQuestionBatch('w2', 1, 'answer', { schemaVersion: 2, answers: [{ questionId: 'q', text: 'Changed' }] })).rejects.toThrow('awaiting confirmation');
  await submitQuestionBatch('w2', 1, 'answer', submission);
  expect(state.fetch).toHaveBeenCalledTimes(2);
  expect(state.fetch.mock.calls[0][1].body).toBe(state.fetch.mock.calls[1][1].body);
});
