import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { request: vi.fn() };
});
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mocks.request } }));
vi.mock('../entry/src/main/ets/service/settings.ets', () => ({ appSettings: { effectiveLanguage: () => 'en-US' } }));
import { homeCommand, mobileRoute, parseHome, recentClosed } from '../entry/src/main/ets/common/homeProtocol.ets';
import { XopcLibraryViewModel, XopcProgressViewModel } from '../entry/src/main/ets/viewmodel/homeViewModel.ets';

describe('mobile home protocol', () => {
  it('maps only recognized internal destinations', () => {
    expect(mobileRoute('/notes?status=inbox')).toEqual({ page: 'inbox', itemId: '' });
    expect(mobileRoute('/notes?status=inbox&item=decision-1')).toEqual({ page: 'inbox', itemId: 'decision-1' });
    expect(mobileRoute('/workflows?runId=run%201')).toEqual({ page: 'workflows', itemId: 'run 1' });
    expect(mobileRoute('/automations?run=a')).toEqual({ page: 'automation-run', itemId: 'a' });
    expect(mobileRoute('/automations?automation=a')).toEqual({ page: 'automations', itemId: 'a' });
    expect(mobileRoute('/chat/conversation')).toEqual({ page: 'chat', itemId: 'conversation' });
    for (const path of ['https://external.example', '//external.example', '/unknown', '/chat/%zz', '/chat/a/b']) {
      expect(mobileRoute(path)).toBeUndefined();
    }
  });
  it('validates mutation types and shapes', () => {
    expect(homeCommand({ type: 'connector_decision', label: 'Approve', approvalId: 'a', decision: 'approve' }))
      .toEqual({ kind: 'connector_approval', approvalId: 'a', decision: 'approve' });
    expect(homeCommand({ type: 'retry_run', label: 'Retry', subjectKind: 'workflow_run', runId: 'r' }))
      .toEqual({ kind: 'workflow_run', runId: 'r' });
    expect(() => homeCommand({ type: 'open', label: 'Open', href: '/tasks' })).toThrow('INVALID_HOME_ACTION');
    expect(() => homeCommand({ type: 'retry_run', label: 'Retry', subjectKind: 'arbitrary', runId: 'r' })).toThrow();
  });
  it('rejects malformed home data and fills optional actions', () => {
    expect(() => parseHome('{}')).toThrow('INVALID_HOME');
    const result = parseHome(JSON.stringify({ needsUser: [{ id: 'a', title: 'A', summary: '' }], background: [] }));
    expect(result.needsUser[0].secondaryActions).toEqual([]);
    expect(() => parseHome('{"needsUser":[{}],"background":[]}')).toThrow('INVALID_HOME_ITEM');
  });
  it('orders all closed resolutions without treating cancelled work as done', () => {
    const items = ['done', 'cancelled', 'wont_do', 'duplicate', 'done', 'done'].map((resolution, index) => ({
      task: { id: String(index), title: 'Task', phase: 'closed', resolution, closedAt: index, version: 1, priority: 'normal' },
    }));
    expect(recentClosed(items).map((task) => task.id)).toEqual(['5', '4', '3', '2', '1']);
    expect(recentClosed(items).at(-1)?.resolution).toBe('cancelled');
  });
});

describe('home loading isolation', () => {
  beforeEach(() => vi.resetAllMocks());
  it('keeps recent tasks usable if the attention feed fails', async () => {
    mocks.request.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/home')) throw new Error('OFFLINE_HOME');
      return JSON.stringify({ items: [{ task: { id: 't', phase: 'closed', closedAt: 1, resolution: 'done' } }] });
    });
    const model = new XopcProgressViewModel(); await model.refresh();
    expect(model.homeError).toBe('OFFLINE_HOME'); expect(model.tasksError).toBe('');
    expect(model.closed[0].id).toBe('t'); expect(model.loading).toBe(false);
    expect(mocks.request).toHaveBeenCalledWith('/api/home?locale=en-US');
  });
  it('ignores responses after disposal', async () => {
    const finish: ((value: string) => void)[] = [];
    mocks.request.mockImplementation(() => new Promise<string>((resolve) => finish.push(resolve)));
    const model = new XopcProgressViewModel(); const loading = model.refresh(); model.dispose();
    finish[0](JSON.stringify({ needsUser: [{ id: 'late', title: 'Late', summary: '' }], background: [] }));
    finish[1](JSON.stringify({ items: [] })); await loading;
    expect(model.needsUser).toEqual([]);
  });
  it('deduplicates refresh and retains independently successful library results', async () => {
    mocks.request.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/notes')) throw new Error('NOTES_FAILED');
      return JSON.stringify({ items: [1, 2, 3, 4].map((id) => ({ id: String(id) })) });
    });
    const model = new XopcLibraryViewModel(); await Promise.all([model.refresh(), model.refresh()]);
    expect(mocks.request).toHaveBeenCalledTimes(2); expect(model.files).toHaveLength(3);
    expect(model.notesError).toBe('NOTES_FAILED'); expect(model.filesError).toBe('');
  });
  it('does not POST invalid attention actions', async () => {
    const model = new XopcProgressViewModel(); await model.act({ type: 'open', label: 'Open' });
    expect(mocks.request).not.toHaveBeenCalled(); expect(model.actionError).toBe('INVALID_HOME_ACTION');
    expect(model.pending).toBe(false);
  });
});
