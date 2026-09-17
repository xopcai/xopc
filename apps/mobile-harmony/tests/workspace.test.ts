import { describe, expect, it } from 'vitest';
import { TaskCreateRequestSchema } from '../../../packages/gateway-contract/src/tasks';
import { CreateAutomationSchema } from '../../../src/automations/domain/validation';
import { automationItem, newTask, scheduledAutomation, taskItem } from '../entry/src/main/ets/common/workspaceProtocol';
import { historyRows } from '../entry/src/main/ets/common/chatProtocol';

describe('Harmony workspace contracts', () => {
  it('creates captured tasks with the authoritative contract and no implicit execution', () => {
    const body = newTask(' Plan ', 'Confirm scope', 'idempotency', 'project');
    expect(TaskCreateRequestSchema.parse(body)).toMatchObject({ title: 'Plan', activation: { mode: 'capture', phase: 'backlog' } });
    expect(body.contract.acceptancePolicy).toBe('manual');
  });
  it('keeps task version and allowed commands for optimistic updates', () => {
    expect(taskItem({ task: { id: 'task', title: 'Title', phase: 'ready', version: 8, priority: 'normal' }, allowedCommands: ['start'] }))
      .toMatchObject({ version: 8, actions: ['start'], status: 'ready' });
    expect(() => taskItem({ task: null! })).toThrow('INVALID_TASK');
  });
  it('only offers editing for scheduled agent automations', () => {
    const base = { id: 'automation', name: 'Daily', enabled: true, trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 9 * * *' } }, action: { kind: 'agent', instruction: 'Summarize' } };
    expect(automationItem(base).editable).toBe(true);
    expect(automationItem({ ...base, action: { kind: 'workflow' } }).editable).toBe(false);
    expect(automationItem({ ...base, trigger: { kind: 'webhook' } }).editable).toBe(false);
  });
  it('preserves existing enabled/conversation/notification settings on automation edits', () => {
    const edit = scheduledAutomation(' Updated ', ' Prompt ', '0 10 * * *', false);
    expect(edit).not.toHaveProperty('enabled'); expect(edit).not.toHaveProperty('afterRun');
    expect(edit).not.toHaveProperty('conversationMode'); expect(edit).not.toHaveProperty('notificationPolicy');
    expect(edit.name).toBe('Updated');
  });
  it('creates valid scheduled automations', () => {
    expect(CreateAutomationSchema.safeParse(scheduledAutomation('Daily', 'Summarize', '0 9 * * *', true)).success).toBe(true);
  });
  it('preserves advanced action fields and cron time zone without mutating the loaded record', () => {
    const original = { id: 'a', name: 'Daily', enabled: false,
      trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Shanghai' } },
      action: { kind: 'agent', instruction: 'old', agentId: 'reviewer', model: 'provider/model', workingDirectory: '/workspace', timeoutSeconds: 120 } };
    const edited = scheduledAutomation('New', 'new', '0 10 * * *', false, original);
    expect(edited.action).toEqual({ ...original.action, instruction: 'new' });
    expect(edited.trigger.schedule).toEqual({ ...original.trigger.schedule, expr: '0 10 * * *' });
    expect(original.action.instruction).toBe('old'); expect(original.trigger.schedule.expr).toBe('0 9 * * *');
  });
  it('renders message blocks without coercing objects or losing their role', () => {
    expect(historyRows({ session: { key: 'id', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Hello' }, { type: 'toolCall', name: 'search' }] }] }, pagination: { hasMore: false } }))
      .toEqual([{ id: 'latest:0', role: 'assistant', text: 'Hello', thinking: '', tools: 'search', media: [],
        toolCalls: [{ id: 'anonymous:0', name: 'search', input: undefined, result: undefined, isError: undefined }] }]);
    expect(() => historyRows({ session: { key: 'id', messages: null! }, pagination: { hasMore: false } })).toThrow('INVALID_HISTORY');
  });
});
