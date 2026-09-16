import { expect, it } from 'vitest';
import { TaskListResponseSchema } from '@xopcai/gateway-contract';
import { recentClosedTasks } from '../progress-sections';

it('sorts actual closed work without calling cancellation or rejection a success', () => {
  const base = { priority: 'normal', source: 'user', latestContractVersion: 1, version: 1, createdAt: 0 };
  const items = TaskListResponseSchema.parse({ ok: true, items: [
    { task: { ...base, id: 'active', title: 'Active', phase: 'active', updatedAt: 100 }, operationalState: 'running', attention: [] },
    { task: { ...base, id: 'done', title: 'Done', phase: 'closed', resolution: 'done', updatedAt: 1, closedAt: 1 }, operationalState: 'idle', attention: [] },
    { task: { ...base, id: 'cancelled', title: 'Cancelled', phase: 'closed', resolution: 'cancelled', updatedAt: 2, closedAt: 2 }, operationalState: 'idle', attention: [] },
    { task: { ...base, id: 'no', title: 'Not proceeding', phase: 'closed', resolution: 'wont_do', updatedAt: 3, closedAt: 3 }, operationalState: 'idle', attention: [] },
  ] }).items;
  expect(recentClosedTasks(items).map(({ task }) => [task.id, task.resolution])).toEqual([['no', 'wont_do'], ['cancelled', 'cancelled'], ['done', 'done']]);
  expect(items[0].task.id).toBe('active');
});
