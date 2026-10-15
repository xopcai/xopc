import { afterEach, describe, expect, it, vi } from 'vitest';

import { EphemeralClarificationWaiter } from '../ephemeral-clarification-waiter.js';

describe('ephemeral clarification lifecycle', () => {
  afterEach(() => vi.useRealTimers());

  it('lets the side chat own the wait deadline and cancellation', async () => {
    vi.useFakeTimers();
    const waiter = new EphemeralClarificationWaiter();
    const settled = vi.fn();
    const answer = waiter.start({ runId: 'run-1', publish: vi.fn(), request: { question: 'Continue?' } });
    const result = answer.then(settled, (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    expect(settled).not.toHaveBeenCalled();
    waiter.cancelForRun('run-1');
    await expect(result).resolves.toContain('cancelled');
    waiter.dispose();
  });

  it('checks the owning lifecycle even when a generic response endpoint answers', async () => {
    const waiter = new EphemeralClarificationWaiter();
    const publish = vi.fn();
    let allowed = false;
    const answer = waiter.start({
      runId: 'run', request: { question: 'Allow this tool?', kind: 'approval', approval: { operation: 'Run tool' }, },
      publish, beforeResponse: () => allowed,
    });
    const requestId = publish.mock.calls[0][0].requestId as string;
    expect(waiter.answer(requestId, { decision: 'approve' })).toBe(false);
    allowed = true;
    expect(waiter.answer(requestId, { decision: 'deny' })).toBe(true);
    await expect(answer).resolves.toBe('deny');
    waiter.dispose();
  });
});

it('normalizes composed side-chat answers and rejects forged choice IDs without ending the wait', async () => {
  const waiter = new EphemeralClarificationWaiter();
  const publish = vi.fn();
  const answer = waiter.start({ runId: 'composed-run', publish, request: { question: 'Where?', interactionMode: 'compose',
    choiceDetails: [{ id: 'stage', label: 'Stage' }, { id: 'prod', label: 'Prod' }] } });
  const event = publish.mock.calls[0][0];
  expect(event).toMatchObject({ choiceDetails: [{ id: 'stage', label: 'Stage' }, { id: 'prod', label: 'Prod' }], interactionMode: 'compose' });
  expect(waiter.answer(event.requestId, { response: { choiceId: 'forged' } })).toBe(false);
  expect(waiter.answer(event.requestId, { response: { choiceId: 'prod', text: 'After 22:00' } })).toBe(true);
  await expect(answer).resolves.toBe('Choice: Prod\nAdditional information: After 22:00');
  expect(waiter.answer(event.requestId, { response: { text: 'Stage' } })).toBe(false);
  waiter.dispose();
});

it('rejects free-form and expired ephemeral approvals', async () => {
  vi.useFakeTimers();
  const waiter = new EphemeralClarificationWaiter();
  const publish = vi.fn();
  const answer = waiter.start({ runId: 'approval-run', publish, request: { kind: 'approval', question: 'Run?', approval: { operation: 'Run tool' }, } });
  const result = answer.catch(error => error.message);
  const event = publish.mock.calls[0][0];
  expect(event.expiresAt).toBe(Date.now() + 600_000);
  expect(waiter.answer(event.requestId, { response: { text: 'Allow once' } })).toBe(false);
  await vi.advanceTimersByTimeAsync(600_001);
  expect(waiter.answer(event.requestId, { decision: 'approve' })).toBe(false);
  waiter.dispose();
  await expect(result).resolves.toContain('shutting down');
  vi.useRealTimers();
});
