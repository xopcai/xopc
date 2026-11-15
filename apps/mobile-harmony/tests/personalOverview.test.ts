import { beforeEach, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined, Computed: () => undefined });
  return vi.fn();
});

vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request } }));

import { XopcPersonalOverviewViewModel } from '../entry/src/main/ets/viewmodel/personalOverviewViewModel';

beforeEach(() => request.mockReset());

it('uses the Personal Agent work feed and counts a shared clarification only once', async () => {
  const model = new XopcPersonalOverviewViewModel();
  const now = Date.now();
  const waiting = { id: 'waiting', title: 'Review', phase: 'review', presentation: { status: 'needsUser' },
    prompt: { id: 'prompt' }, updatedAt: now };
  const running = { id: 'running', title: 'Running', phase: 'active', operationalState: 'running', updatedAt: now };
  const failed = { id: 'failed', title: 'Ended', phase: 'active', operationalState: 'failed', updatedAt: now };
  request.mockResolvedValueOnce(JSON.stringify({ payload: { current: [waiting, running, failed], items: [failed], total: 2 } }));
  request.mockResolvedValueOnce(JSON.stringify({ payload: { clarification: { id: 'prompt', status: 'open', question: 'Review' } } }));
  await model.work();
  await model.loadPrompt('personal/chat');
  expect(request.mock.calls.map(([path]) => path)).toEqual([
    '/api/personal-agent/activity?view=work&limit=10&offset=0',
    '/api/sessions/personal%2Fchat/clarification',
  ]);
  expect(model.attentionCount).toBe(1);
  expect(model.active.map(item => item.id)).toEqual(['running']);
  expect(model.runningCount).toBe(1);
  expect(model.groups.flatMap(group => group.items).map(item => item.id)).toEqual(['failed']);
  request.mockResolvedValueOnce(JSON.stringify({
    payload: { current: [], items: [{ id: 'earlier', updatedAt: 1 }], total: 2 },
  }));
  await model.work(true);
  expect(request).toHaveBeenLastCalledWith('/api/personal-agent/activity?view=work&limit=10&offset=1');
  expect(model.groups.flatMap(group => group.items).map(item => item.id)).toEqual(['failed', 'earlier']);
  expect(model.moreWork).toBe(false);
});

it('uses only the scoped Personal schedules and deliveries feeds', async () => {
  const model = new XopcPersonalOverviewViewModel();
  request.mockResolvedValueOnce(JSON.stringify({ payload: [{ id: 'later', state: { nextRunAtMs: 2 } },
    { id: 'sooner', state: { nextRunAtMs: 1 } }] }));
  await model.loadSchedules();
  expect(request).toHaveBeenLastCalledWith('/api/personal-agent/schedules');
  expect(model.schedules.map(item => item.id)).toEqual(['sooner', 'later']);
  request.mockResolvedValueOnce(JSON.stringify({ payload: { items: [{ id: 'one' }], nextOffset: 15 } }));
  request.mockResolvedValueOnce(JSON.stringify({ payload: { items: [{ id: 'one' }, { id: 'two' }], nextOffset: null } }));
  await model.loadDeliveries();
  await model.loadDeliveries(true);
  expect(request).toHaveBeenLastCalledWith('/api/personal-agent/activity?view=deliverables&limit=15&offset=15');
  expect(model.deliveries.map(item => item.id)).toEqual(['one', 'two']);
  expect(model.nextDeliveryOffset).toBeNull();
});

it('keeps displayed deliveries and retries the page that failed', async () => {
  const model = new XopcPersonalOverviewViewModel();
  request.mockResolvedValueOnce(JSON.stringify({ payload: { items: [{ id: 'one' }], nextOffset: 15 } }));
  await model.loadDeliveries();

  request.mockRejectedValueOnce(new Error('Refresh failed'));
  await model.loadDeliveries();
  expect(model.deliveries.map(item => item.id)).toEqual(['one']);
  request.mockResolvedValueOnce(JSON.stringify({ payload: { items: [{ id: 'new' }], nextOffset: 15 } }));
  await model.retryDeliveries();
  expect(request).toHaveBeenLastCalledWith('/api/personal-agent/activity?view=deliverables&limit=15&offset=0');

  request.mockRejectedValueOnce(new Error('Next page failed'));
  await model.loadDeliveries(true);
  expect(model.deliveries.map(item => item.id)).toEqual(['new']);
  request.mockResolvedValueOnce(JSON.stringify({ payload: { items: [{ id: 'next' }], nextOffset: null } }));
  await model.retryDeliveries();
  expect(request).toHaveBeenLastCalledWith('/api/personal-agent/activity?view=deliverables&limit=15&offset=15');
  expect(model.deliveries.map(item => item.id)).toEqual(['new', 'next']);
});
