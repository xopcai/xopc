import { describe, expect, it } from 'vitest';
import { TaskCreateRequestSchema } from '../../../packages/gateway-contract/src/tasks';
import { automationItem, automationCronLabel, newTask, projectItem, scheduledAutomationPatch, taskItem } from '../entry/src/main/ets/common/workspaceProtocol';
import { historyRows } from '../entry/src/main/ets/common/chatProtocol';

describe('automation schedule labels', () => {
  it('distinguishes daily, weekly, monthly, interval, and custom schedules', () => {
    expect(automationCronLabel('0 9 * * *')).toEqual({ cadence: 'daily', time: '09:00' });
    expect(automationCronLabel('0 9 * * 1')).toEqual({ cadence: 'weekday', time: '09:00', value: 1 });
    expect(automationCronLabel('0 9 * * 1-5')).toEqual({ cadence: 'workdays', time: '09:00' });
    expect(automationCronLabel('30 18 15 * *')).toEqual({ cadence: 'monthly', time: '18:30', value: 15 });
    expect(automationCronLabel('*/30 * * * *')).toEqual({ cadence: 'minutes', value: 30 });
    expect(automationCronLabel('0 */2 * * *')).toEqual({ cadence: 'hours', value: 2 });
    for (const expression of ['0 9 * * 1,4', '0 24 * * *', '60 9 * * *', '*/7 * * * *', '0 */5 * * *']) {
      expect(automationCronLabel(expression)).toEqual({ cadence: 'custom' });
    }
  });
});

describe('Harmony workspace contracts', () => {
  it('creates captured tasks with the authoritative contract and no implicit execution', () => {
    const body = newTask(' Plan ', 'Confirm scope', 'idempotency', 'project');
    expect(TaskCreateRequestSchema.parse(body)).toMatchObject({ title: 'Plan', activation: { mode: 'capture', phase: 'backlog' } });
    expect(body.contract.acceptancePolicy).toBe('manual');
  });
  it('keeps task version and allowed commands for optimistic updates', () => {
    expect(taskItem({ task: { id: 'task', title: 'Title', phase: 'ready', version: 8, priority: 'high',
      projectId: 'mobile', updatedAt: 1_780_000_000_000 }, allowedCommands: ['start'] }))
      .toMatchObject({ version: 8, actions: ['start'], status: 'ready', priority: 'high',
        projectId: 'mobile', updatedAt: 1_780_000_000_000 });
    expect(() => taskItem({ task: null! })).toThrow('INVALID_TASK');
  });
  it('keeps project brief and outcome for mobile overview and detail cards', () => {
    expect(projectItem({ id: 'project', name: 'Mobile', status: 'active', description: 'Ship the app',
      brief: 'Harmony client', outcome: 'Stable release' }))
      .toMatchObject({ title: 'Mobile', status: 'active', body: 'Ship the app', brief: 'Harmony client',
        outcome: 'Stable release' });
  });
  it('only offers editing for scheduled agent automations', () => {
    const base = { id: 'automation', name: 'Daily', enabled: true, trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 9 * * *' } }, action: { kind: 'agent', instruction: 'Summarize' } };
    expect(automationItem(base).editable).toBe(true);
    expect(automationItem({ ...base, action: { kind: 'system' } }).editable).toBe(false);
    expect(automationItem({ ...base, trigger: { kind: 'webhook' } }).editable).toBe(false);
  });
  it('preserves advanced action fields and cron time zone without mutating the loaded record', () => {
    const original = { id: 'a', name: 'Daily', enabled: false, updatedAtMs: 7, projectId: 'project',
      trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Shanghai' } },
      action: { kind: 'agent', instruction: 'old', agentId: 'reviewer', model: 'provider/model', workingDirectory: '/workspace', timeoutSeconds: 120 } };
    const edited = scheduledAutomationPatch(' New ', 'new', '0 10 * * *', original);
    expect(edited).toEqual({ name: 'New', expectedRevision: 7,
      trigger: { ...original.trigger, schedule: { ...original.trigger.schedule, expr: '0 10 * * *' } },
      action: { ...original.action, instruction: 'new' } });
    expect(original.action.instruction).toBe('old'); expect(original.trigger.schedule.expr).toBe('0 9 * * *');
  });
  it('renders message blocks without coercing objects or losing their role', () => {
    expect(historyRows({ session: { key: 'id', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Hello' }, { type: 'toolCall', name: 'search' }] }] }, pagination: { hasMore: false } }))
      .toMatchObject([{ id: 'latest:0', role: 'assistant', text: 'Hello', thinking: '', tools: 'search', media: [],
        toolCalls: [{ id: 'latest:0:anonymous:0', name: 'search', status: 'pending' }] }]);
    expect(() => historyRows({ session: { key: 'id', messages: null! }, pagination: { hasMore: false } })).toThrow('INVALID_HISTORY');
  });
});
