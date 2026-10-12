import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeActionSchema } from '../../../packages/gateway-contract/src/home';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { request: vi.fn() };
});
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mocks.request } }));
vi.mock('../entry/src/main/ets/service/settings.ets', () => ({ appSettings: { effectiveLanguage: () => 'en-US' } }));
import { dispatchHomeAction, homeCommand, mobileRoute, parseHome, recentClosed } from '../entry/src/main/ets/common/homeProtocol.ets';
import { XopcProgressViewModel } from '../entry/src/main/ets/viewmodel/homeViewModel.ets';

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
  it('does not POST invalid attention actions', async () => {
    const model = new XopcProgressViewModel(); await model.act({ type: 'open', label: 'Open' });
    expect(mocks.request).not.toHaveBeenCalled(); expect(model.actionError).toBe('INVALID_HOME_ACTION');
    expect(model.pending).toBe(false);
  });
});

describe('progress action dispatch', () => {
  beforeEach(() => vi.resetAllMocks());

  it('opens the task returned by the review action without confirmation or a mutation request', async () => {
    const action = HomeActionSchema.parse({ type: 'task_review', label: '查看结果并验收', taskId: 'task-review-1' });
    const home = parseHome(JSON.stringify({ needsUser: [{ id: 'decision', kind: 'decision', title: 'Review', summary: '',
      primaryAction: action, openAction: { type: 'open', label: 'Open chat', href: '/chat/different-id' } }], background: [] }));
    const model = new XopcProgressViewModel();
    const navigate = vi.fn(); const confirm = vi.fn();
    await dispatchHomeAction(home.needsUser[0].primaryAction!, {
      navigate, confirm, mutate: (command) => model.act(command),
    });
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ page: 'tasks', itemId: 'task-review-1' });
    expect(confirm).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
    expect(model.actionError).toBe(''); expect(model.pending).toBe(false);
  });

  it('rejects missing task identities and unsupported actions before showing a confirmation', async () => {
    const handlers = { navigate: vi.fn(), confirm: vi.fn(), mutate: vi.fn() };
    for (const action of [{ type: 'task_review', label: 'Review' }, { type: 'task_review', label: 'Review', taskId: ' ' },
      { type: 'unknown_action', label: 'Unknown' }]) {
      await expect(dispatchHomeAction(action, handlers)).rejects.toThrow('INVALID_HOME_ACTION');
    }
    expect(handlers.navigate).not.toHaveBeenCalled(); expect(handlers.confirm).not.toHaveBeenCalled();
    expect(handlers.mutate).not.toHaveBeenCalled();
  });

  it('navigates ordinary links and rejects external destinations before confirmation', async () => {
    const handlers = { navigate: vi.fn(), confirm: vi.fn(), mutate: vi.fn() };
    await dispatchHomeAction({ type: 'open', label: 'Details', href: '/tasks/task%201' }, handlers);
    expect(handlers.navigate).toHaveBeenCalledExactlyOnceWith({ page: 'tasks', itemId: 'task 1' });
    await expect(dispatchHomeAction({ type: 'open', label: 'External', href: 'https://example.com' }, handlers))
      .rejects.toThrow('UNSUPPORTED_ROUTE');
    expect(handlers.confirm).not.toHaveBeenCalled(); expect(handlers.mutate).not.toHaveBeenCalled();
  });

  it('keeps write actions behind confirmation and stops when the user cancels', async () => {
    const action = { type: 'connector_decision', label: 'Approve', approvalId: 'approval', decision: 'approve' };
    const handlers = { navigate: vi.fn(), confirm: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      mutate: vi.fn() };
    await dispatchHomeAction(action, handlers);
    expect(handlers.mutate).not.toHaveBeenCalled();
    await dispatchHomeAction(action, handlers);
    expect(handlers.mutate).toHaveBeenCalledExactlyOnceWith(action);
    expect(handlers.navigate).not.toHaveBeenCalled();
  });

  it('propagates dispatch failures for visible feedback', async () => {
    const handlers = { navigate: vi.fn(), confirm: vi.fn().mockResolvedValue(true),
      mutate: vi.fn().mockRejectedValue(new Error('HTTP_403')) };
    await expect(dispatchHomeAction({ type: 'retry_run', label: 'Retry', subjectKind: 'workflow_run', runId: 'run' }, handlers))
      .rejects.toThrow('HTTP_403');
  });
});
