// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automationApi, type Automation } from '@/features/automations/automation-api';
import { TaskSchedulePanel } from '../task-schedule-panel';

vi.mock('@/features/automations/automation-api', () => ({ automationApi: { update: vi.fn() } }));

function schedule(): Automation {
  return {
    id: 'schedule-1', name: 'Report schedule', enabled: true,
    trigger: { kind: 'schedule', schedule: { kind: 'once', at: '2099-10-28T06:30:00.000Z' } },
    action: { kind: 'task_command', taskId: 'task-1', command: { type: 'start', executor: { kind: 'agent', agentId: 'main' } } },
    delivery: { notificationPolicy: 'attention', destinations: [] }, conversationMode: 'new_session',
    state: { nextRunAtMs: Date.parse('2099-10-28T06:30:00.000Z') }, createdAtMs: 1, updatedAtMs: 42,
  };
}

describe('task execution schedule panel', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const onUpdated = vi.fn(); const onEdit = vi.fn();
  const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === label)!;
  const render = async (value = schedule()) => { await act(async () => root.render(<MemoryRouter><TaskSchedulePanel schedules={[value]} language="zh" onEdit={onEdit} onUpdated={onUpdated} /></MemoryRouter>)); };
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks();
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it('shows the scheduled date and authoritative next run with an edit entry', async () => {
    const value = schedule(); await render(value);
    expect(container.textContent).toContain('单次执行：2099');
    expect(container.textContent).toContain('下次执行：2099');
    act(() => button('修改时间').click()); expect(onEdit).toHaveBeenCalledWith(value);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/automations?automation=schedule-1');
  });

  it('cancels future triggers without deleting the automation and updates the parent cache', async () => {
    const value = schedule(); const cancelled = { ...value, enabled: false };
    vi.mocked(automationApi.update).mockResolvedValue({ automation: cancelled });
    await render(value); await act(async () => button('取消定时执行').click());
    expect(automationApi.update).toHaveBeenCalledWith('schedule-1', { enabled: false, expectedRevision: 42 });
    expect(onUpdated).toHaveBeenCalledWith(cancelled);
    await render(cancelled);
    expect(container.textContent).toContain('已取消，不再自动执行');
    expect(button('取消定时执行')).toBeUndefined();
    expect(button('修改时间')).toBeDefined();
    expect(container.querySelector('a')).not.toBeNull();
  });

  it('keeps a cancellation failure visible and leaves the displayed schedule intact', async () => {
    vi.mocked(automationApi.update).mockRejectedValue(new Error('Schedule changed. Refresh first.'));
    await render(); await act(async () => button('取消定时执行').click());
    expect(onUpdated).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Schedule changed');
    expect(container.textContent).toContain('下次执行：2099');
  });

  it('shows recurring time and schedule timezone separately from local next-run time', async () => {
    const value = schedule(); value.trigger = { kind: 'schedule', schedule: { kind: 'cron', expr: '30 9 * * *', tz: 'Asia/Shanghai' } };
    await render(value);
    expect(container.textContent).toContain('9:30'); expect(container.textContent).toContain('Asia/Shanghai');
  });
  it('distinguishes an executed one-time schedule from a cancelled schedule', async () => {
    const value = schedule(); value.enabled = false;
    value.state = { lastRunAtMs: Date.parse('2099-10-28T06:30:00.000Z'), lastRunStatus: 'succeeded' };
    await render(value);
    expect(container.textContent).toContain('已执行，无后续计划');
    expect(container.textContent).not.toContain('已取消定时执行');
  });

});
