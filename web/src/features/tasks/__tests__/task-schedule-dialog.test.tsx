// @vitest-environment jsdom
import { act, type SelectHTMLAttributes } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automationApi, type Automation } from '@/features/automations/automation-api';
import { TaskScheduleDialog } from '../task-schedule-dialog';

vi.mock('@/features/automations/automation-api', () => ({ automationApi: { create: vi.fn(), update: vi.fn() } }));
vi.mock('@/components/ui/popover-select', () => ({
  Select: (props: SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} />,
  SelectOption: (props: SelectHTMLAttributes<HTMLOptionElement>) => <option {...props} />,
}));

function Location() { const location = useLocation(); return <output data-location>{location.pathname}{location.search}</output>; }
const created = { id: 'automation/1', name: 'Report schedule' } as Automation;

describe('task schedule dialog', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const onCreated = vi.fn();
  const onClose = vi.fn();
  const button = (label: string) => [...document.querySelectorAll('button')].find((item) => item.textContent === label)!;
  const input = () => document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
  const setDate = (value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
  const submit = async () => { await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); };
  const render = async (executorAgentId: string | undefined = 'researcher', automation?: Automation) => {
    await act(async () => root.render(<MemoryRouter initialEntries={['/tasks/task-1']}><Location /><TaskScheduleDialog automation={automation} taskId="task-1" taskTitle="Report" projectId="project-1" executorAgentId={executorAgentId} language="zh" onCreated={onCreated} onClose={onClose} /></MemoryRouter>));
  };
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    vi.mocked(automationApi.create).mockResolvedValue({ automation: created });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it('creates the current task schedule without navigating, then links to the created automation', async () => {
    await render();
    setDate('2099-10-28T14:30');
    await submit();
    expect(automationApi.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Report', projectId: 'project-1', enabled: true,
      trigger: { kind: 'schedule', schedule: { kind: 'once', at: new Date('2099-10-28T14:30').toISOString() } },
      action: { kind: 'task_command', taskId: 'task-1', command: { type: 'start', executor: { kind: 'agent', agentId: 'researcher' } } },
      safety: { mode: 'auto_apply' },
    }));
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(document.querySelector('[data-location]')?.textContent).toBe('/tasks/task-1');
    expect(document.querySelector('[role="status"]')?.textContent).toBe('执行时间已设置');
    const link = document.querySelector<HTMLAnchorElement>('a')!;
    expect(link.getAttribute('href')).toBe('/automations?automation=automation%2F1');
    act(() => link.click());
    expect(document.querySelector('[data-location]')?.textContent).toBe('/automations?automation=automation%2F1');
  });

  it('validates future time and retains entered values after a failed create', async () => {
    await render(); setDate('2000-01-01T10:00'); await submit();
    expect(automationApi.create).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    setDate('2099-10-28T14:30');
    vi.mocked(automationApi.create).mockRejectedValueOnce(new Error('Connection failed'));
    await submit();
    expect(input().value).toBe('2099-10-28T14:30');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Connection failed');
    expect(onCreated).not.toHaveBeenCalled();
    await submit(); expect(onCreated).toHaveBeenCalledWith(created);
  });

  it.each(['daily', 'weekly'])('creates a %s schedule with an explicit timezone', async (mode) => {
    await render();
    const trigger = document.querySelector<HTMLSelectElement>('select')!;
    act(() => { trigger.value = mode; trigger.dispatchEvent(new Event('change', { bubbles: true })); });
    await submit();
    expect(automationApi.create).toHaveBeenCalledWith(expect.objectContaining({ trigger: { kind: 'schedule', schedule: {
      kind: 'cron', expr: mode === 'daily' ? '0 9 * * *' : '0 9 * * 1', tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    } } }));
  });

  it('prevents duplicate submission while creation is pending', async () => {
    let finish!: (value: { automation: Automation }) => void;
    vi.mocked(automationApi.create).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await render(); setDate('2099-10-28T14:30');
    await submit(); await submit();
    expect(automationApi.create).toHaveBeenCalledOnce();
    expect(button('正在保存…').disabled).toBe(true);
    await act(async () => finish({ automation: created }));
    expect(onCreated).toHaveBeenCalledOnce();
  });
  function existingSchedule(): Automation {
    return {
      id: 'existing-1', name: 'Existing report schedule', projectId: 'project-1', enabled: true,
      trigger: { kind: 'schedule', schedule: { kind: 'once', at: '2099-10-28T06:30:00.000Z' } },
      action: { kind: 'task_command', taskId: 'task-1', command: { type: 'start', executor: { kind: 'agent', agentId: 'original-executor' } } },
      delivery: { notificationPolicy: 'all', destinations: [{ key: 'file', kind: 'file', targetId: 'report', pathTemplate: 'report.txt' }] },
      conversationMode: 'continuous', state: { nextRunAtMs: 123 }, createdAtMs: 1, updatedAtMs: 42,
    };
  }

  it('edits the existing automation with revision checking while preserving its action and destinations', async () => {
    const existing = existingSchedule();
    vi.mocked(automationApi.update).mockResolvedValue({ automation: existing });
    await render('', existing);
    expect(input().value).not.toBe('');
    setDate('2099-10-29T15:00');
    await submit();
    expect(automationApi.create).not.toHaveBeenCalled();
    expect(automationApi.update).toHaveBeenCalledWith('existing-1', {
      name: existing.name, trigger: { kind: 'schedule', schedule: { kind: 'once', at: new Date('2099-10-29T15:00').toISOString() } },
      enabled: true, delivery: existing.delivery, expectedRevision: 42,
    });
    expect(onCreated).toHaveBeenCalledWith(existing);
    expect(document.querySelector('[role="status"]')?.textContent).toBe('执行时间已更新');
  });

  it('keeps an existing custom cron rule and timezone when editing', async () => {
    const existing = existingSchedule();
    existing.trigger = { kind: 'schedule', schedule: { kind: 'cron', expr: '0 */3 * * *', tz: 'Asia/Shanghai' } };
    vi.mocked(automationApi.update).mockResolvedValue({ automation: existing });
    await render('researcher', existing); await submit();
    expect(automationApi.update).toHaveBeenCalledWith(existing.id, expect.objectContaining({ trigger: existing.trigger }));
    expect(automationApi.create).not.toHaveBeenCalled();
  });

  it('offers explicit re-enabling when editing a cancelled schedule', async () => {
    const existing = existingSchedule(); existing.enabled = false;
    vi.mocked(automationApi.update).mockResolvedValue({ automation: existing });
    await render('researcher', existing);
    expect(button('保存并启用')).toBeDefined();
    await submit();
    expect(automationApi.update).toHaveBeenCalledWith(existing.id, expect.objectContaining({ enabled: true }));
  });

  it('preserves the anchor of an existing interval schedule', async () => {
    const existing = existingSchedule();
    existing.trigger = { kind: 'schedule', schedule: { kind: 'interval', everyMs: 3600000, anchorMs: 123456 } };
    vi.mocked(automationApi.update).mockResolvedValue({ automation: existing });
    await render('researcher', existing); await submit();
    expect(automationApi.update).toHaveBeenCalledWith(existing.id, expect.objectContaining({ trigger: existing.trigger }));
  });

});
