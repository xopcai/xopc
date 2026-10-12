import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskCommandRequestSchema, TaskPatchRequestSchema } from '../../../packages/gateway-contract/src/tasks';
import { taskDetailItem } from '../entry/src/main/ets/common/workspaceProtocol';
import { taskCommand, taskCompletionBlock, taskCriterionState, taskPhaseAction } from '../entry/src/main/ets/common/taskManagement';
import type { XopcMobileTaskDetailResult } from '../entry/src/main/ets/model/workspace';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { request: vi.fn(), uuid: vi.fn(() => 'mutation-id') };
});
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mocks.request } }));
vi.mock('../entry/src/main/ets/service/deviceCrypto.ets', () => ({ XopcDeviceCrypto: class { uuid = mocks.uuid; } }));
import { XopcWorkspaceRepository } from '../entry/src/main/ets/repository/workspaceRepository';
import { XopcWorkspaceViewModel } from '../entry/src/main/ets/viewmodel/workspaceViewModel';

function detail(): XopcMobileTaskDetailResult {
  return { task: { id: 'task 1', title: 'Plan', phase: 'ready', version: 3, priority: 'high', dueAt: 1234,
    projectId: 'project', latestContractVersion: 2,
    contract: { objective: 'Ship', expectedOutputs: [], acceptanceCriteria: ['Works'], constraints: [],
      approvalRequired: [], assumptions: [], risks: [], acceptancePolicy: 'manual', outputDestinations: [] } },
    operationalState: 'idle', waits: [], allowedCommands: ['move', 'start', 'close'], attention: [],
    criterionReviews: [{ contractVersion: 2, criterionIndex: 0, status: 'passed', reviewedAt: 1 }],
    receipts: [], context: [], sessions: [], dependencies: [], dependents: [], runs: [] };
}

beforeEach(() => { mocks.request.mockReset(); mocks.uuid.mockClear(); });

describe('Harmony task management', () => {
  it('preserves lifecycle, resolution, due date, waits and execution separately', () => {
    expect(taskDetailItem({ ...detail(), task: { ...detail().task, phase: 'closed', resolution: 'cancelled' },
      operationalState: 'waiting', waits: [{ id: 'wait', status: 'active', kind: 'paused', reason: 'Pause' }] }))
      .toMatchObject({ status: 'closed', resolution: 'cancelled', dueAt: 1234,
        taskDetail: { operationalState: 'waiting', waits: [{ id: 'wait' }] } });
  });

  it('changes phase without launching an Agent and only exposes permitted moves', () => {
    const item = taskDetailItem(detail());
    expect(taskPhaseAction(item, 'active')).toBe('move:active');
    expect(taskCommand(item, 'move:active', '')).toEqual({ type: 'move', phase: 'active' });
    expect(taskPhaseAction(item, 'ready')).toBe('');
    expect(taskPhaseAction({ ...item, actions: ['close'] }, 'active')).toBe('');
    expect(() => taskCommand({ ...item, actions: ['close'] }, 'move:active', '')).toThrow('INVALID_ACTION');
    expect(taskCommand({ ...item, status: 'closed', actions: ['reopen'] }, 'reopen:review', ''))
      .toEqual({ type: 'reopen', phase: 'review' });
    expect(() => taskCommand(item, 'move:closed', '')).toThrow('INVALID_ACTION');
  });

  it('keeps completion gated by current contract reviews, root runs and waits while allowing cancellation', () => {
    const item = taskDetailItem(detail());
    expect(taskCompletionBlock(item)).toBe('');
    expect(taskCommand(item, 'close', '')).toEqual({ type: 'close', resolution: 'done' });
    item.taskDetail!.criterionReviews[0].contractVersion = 1;
    expect(taskCompletionBlock(item)).toBe('acceptance');
    expect(() => taskCommand(item, 'close', '')).toThrow('TASK_ACCEPTANCE_REQUIRED');
    expect(taskCommand(item, 'cancel_task', '')).toEqual({ type: 'close', resolution: 'cancelled' });
    item.taskDetail!.criterionReviews[0].contractVersion = 2;
    item.taskDetail!.runs = [{ id: 'run', contractVersion: 2, status: 'running' }];
    expect(taskCompletionBlock(item)).toBe('execution');
    item.taskDetail!.runs = [];
    item.taskDetail!.waits = [{ id: 'wait', status: 'active', kind: 'paused', reason: 'Pause' }];
    expect(taskCompletionBlock(item)).toBe('execution');
    item.taskDetail!.waits = [];
    item.taskDetail!.contract!.acceptanceCriteria = [];
    expect(taskCompletionBlock(item)).toBe('criteria');
  });

  it('requires current verified evidence for automatic acceptance and honors the latest decisive check', () => {
    const info = taskDetailItem(detail()).taskDetail!;
    info.contract!.acceptancePolicy = 'verified_auto';
    info.runs = [{ id: 'new', contractVersion: 2 }, { id: 'old', contractVersion: 1 }];
    const receipt = { runId: 'new', summary: '', status: 'succeeded', finalizedAt: 1, remainingWork: [],
      verification: { checks: [{ criterion: 'Works', status: 'passed', evidenceTitles: ['Check'] }] },
      evidence: [{ kind: 'test', title: 'Check', strength: 'verified' }] };
    info.receipts = [{ ...receipt, runId: 'old' }];
    expect(taskCriterionState(info, 'Works', 0)).toBe('pending');
    info.receipts = [receipt];
    expect(taskCriterionState(info, 'Works', 0)).toBe('passed');
    info.receipts.unshift({ ...receipt, finalizedAt: 2,
      verification: { checks: [{ criterion: 'Works', status: 'failed', evidenceTitles: ['Check'] }] } });
    expect(taskCriterionState(info, 'Works', 0)).toBe('failed');
  });

  it('uses versioned canonical requests and explicitly clears optional properties', async () => {
    const repository = new XopcWorkspaceRepository();
    const item = taskDetailItem(detail());
    await repository.save('tasks', { ...item, title: ' Changed ', projectId: undefined, priority: 'critical', dueAt: undefined }, 'key');
    const [path, method, raw] = mocks.request.mock.calls[0];
    expect([path, method]).toEqual(['/api/tasks/task%201', 'PATCH']);
    expect(TaskPatchRequestSchema.parse(JSON.parse(raw))).toEqual({ expectedVersion: 3, title: 'Changed',
      body: '', projectId: null, priority: 'critical', dueAt: null });
    await repository.action('tasks', item, 'move:active', '', 'key');
    expect(TaskCommandRequestSchema.parse(JSON.parse(mocks.request.mock.calls[1][2])))
      .toEqual({ expectedVersion: 3, idempotencyKey: 'key', command: { type: 'move', phase: 'active' } });
    expect(() => taskCommand(item, 'start', '')).toThrow('AGENT_REQUIRED');
  });

  it('refreshes successful mutations without clearing selected detail and retains failed edits', async () => {
    const model = new XopcWorkspaceViewModel();
    mocks.request.mockResolvedValueOnce(JSON.stringify(detail()));
    await model.open('task 1');
    const selected = model.selected;
    model.editing = true; model.title = 'Changed'; model.priority = 'low'; model.dueAt = undefined; model.projectId = '';
    mocks.request.mockRejectedValueOnce(new Error('HTTP_409'));
    await model.save();
    expect(model.selected).toBe(selected); expect(model.editing).toBe(true);
    expect(model.title).toBe('Changed'); expect(model.error).toBe('HTTP_409');
    model.cancelEdit();
    expect(model.editing).toBe(false); expect(model.priority).toBe('high'); expect(model.dueAt).toBe(1234);
    mocks.request.mockResolvedValueOnce('{}').mockImplementationOnce(async () => {
      expect(model.selected).toBe(selected);
      return JSON.stringify({ ...detail(), task: { ...detail().task, version: 4, phase: 'active' } });
    });
    await model.action('move:active', '');
    expect(model.selected).toMatchObject({ status: 'active', version: 4 });
    expect(model.error).toBe(''); expect(model.busy).toBe(false);
  });
  it('continues reloading automation run history after actions in the shared detail model', async () => {
    const automation = { id: 'automation', name: 'Daily', enabled: true,
      trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 9 * * *' } },
      action: { kind: 'agent', instruction: 'Summarize' } };
    mocks.request.mockResolvedValueOnce(JSON.stringify({ automations: [] }));
    const model = new XopcWorkspaceViewModel();
    model.start('automations');
    await vi.waitFor(() => expect(model.busy).toBe(false));
    mocks.request.mockResolvedValueOnce(JSON.stringify({ automation }))
      .mockResolvedValueOnce(JSON.stringify({ runs: [] }));
    await model.open('automation');
    mocks.request.mockResolvedValueOnce('{}').mockResolvedValueOnce(JSON.stringify({ automation }))
      .mockResolvedValueOnce(JSON.stringify({ runs: [{ id: 'new-run', status: 'running' }] }));
    await model.action('run', '');
    expect(model.runs).toEqual([{ id: 'new-run', status: 'running' }]);
  });

});
