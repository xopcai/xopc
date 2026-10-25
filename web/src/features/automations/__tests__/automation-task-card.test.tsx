// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../automation-api', () => ({ automationApi: { get: vi.fn(), update: vi.fn(), create: vi.fn(), openConfiguration: vi.fn() } }));
vi.mock('@/components/markdown/markdown-view', () => ({ MarkdownView: ({ content }: { content: string }) => <div>{content}</div> }));
vi.mock('@/features/chat/model/model-selector', () => ({ ModelSelector: () => null }));
vi.mock('@/features/chat/agent-selection/chat-agents-api', () => ({ fetchChatAgents: async () => ({ defaultId: 'main', items: [{ id: 'main', name: 'Main' }, { id: 'research', name: 'Research' }] }) }));
import { automationApi, type Automation } from '../automation-api';
import { AutomationTaskCard, AutomationEditDialog } from '../automation-task-card';

const task: Automation = {
  id: 'weekly', name: 'Current saved task', enabled: true,
  trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 10 * * 1', tz: 'Asia/Shanghai' } },
  action: { kind: 'agent', instruction: '## Weekly report\nSummarize progress.' },
  conversationMode: 'new_session', delivery: { notificationPolicy: 'all', destinations: [] },
  state: { nextRunAtMs: Date.UTC(2026, 10, 2, 2) }, createdAtMs: 1, updatedAtMs: 3,
};
function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}</output>; }
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.mocked(automationApi.get).mockResolvedValue({ automation: task });
  vi.mocked(automationApi.openConfiguration).mockResolvedValue({ conversationId: 'canonical-chat' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const button = (text: string) => Array.from(container.querySelectorAll('button')).find(element => element.textContent === text)!;

describe('scheduled task card and shared editor', () => {
  it('keeps a run card attached to its execution even when task state points to a newer run', async () => {
    vi.mocked(automationApi.get).mockResolvedValue({ automation: { ...task, state: { ...task.state, lastRunId: 'newer-run' } } as Automation });
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><MemoryRouter><AutomationTaskCard automationId="weekly" runId="original-run" language="zh" /></MemoryRouter></SWRConfig>));
    const link = Array.from(container.querySelectorAll('a')).find(anchor => anchor.textContent === '查看运行情况');
    expect(link?.getAttribute('href')).toBe('/automations?automation=weekly&view=run&run=original-run');
  });
  it('saves a completed task without rescheduling or losing its original seconds', async () => {
    vi.mocked(automationApi.update).mockResolvedValue({ automation: task });
    const completed = { ...task, enabled: false, trigger: { kind: 'schedule' as const, schedule: { kind: 'once' as const, at: '2020-01-01T01:00:33Z' } } };
    await act(async () => root.render(<AutomationEditDialog automation={completed} language="zh" onClose={vi.fn()} />));
    await act(async () => Array.from(document.querySelectorAll('button')).find(element => element.textContent === '保存')!.click());
    expect(automationApi.update).toHaveBeenCalled();
    const patch = vi.mocked(automationApi.update).mock.calls.at(-1)![1];
    expect(patch).not.toHaveProperty('trigger');
    expect(patch).not.toHaveProperty('enabled');
  });
  it('saves the execution assistant from advanced settings while preserving the task action', async () => {
    vi.mocked(automationApi.update).mockResolvedValue({ automation: task });
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><AutomationEditDialog automation={task} language="zh" onClose={vi.fn()} /></SWRConfig>));
    const advanced = document.querySelector('details')!;
    expect(advanced.open).toBe(false);
    await act(async () => { advanced.open = true; });
    await act(async () => (document.querySelector('[aria-label="执行助手"]') as HTMLButtonElement).click());
    const choice = Array.from(document.querySelectorAll('button')).find(element => element.textContent?.includes('Research'));
    expect(choice).toBeDefined();
    await act(async () => (choice as HTMLElement).click());
    await act(async () => Array.from(document.querySelectorAll('button')).find(element => element.textContent === '保存')!.click());
    expect(automationApi.update).toHaveBeenCalledWith(task.id, expect.objectContaining({
      action: expect.objectContaining({ kind: 'agent', agentId: 'research', instruction: task.action.kind === 'agent' ? task.action.instruction : '' }),
      expectedRevision: task.updatedAtMs,
    }));
  });
  it('reads the saved schedule and resumes the canonical configuration conversation', async () => {
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><MemoryRouter><AutomationTaskCard automationId="weekly" language="zh" /><Location /></MemoryRouter></SWRConfig>));
    expect(container.textContent).toContain('Current saved task');
    expect(container.textContent).toContain('10:00');
    expect(container.textContent).toContain('Asia/Shanghai');
    await act(async () => button('继续对话').click());
    expect(automationApi.openConfiguration).toHaveBeenCalledWith({ automationId: 'weekly', projectId: undefined });
    expect(container.querySelector('output')?.textContent).toBe('/automations?automation=weekly');
  });

  it('keeps the original revision and user edits on a conflicting save', async () => {
    const close = vi.fn();
    vi.mocked(automationApi.update).mockRejectedValue(Object.assign(new Error('Automation changed'), { status: 409 }));
    await act(async () => root.render(<AutomationEditDialog automation={task} language="zh" onClose={close} />));
    // A poll updates the parent, but the open editor must not silently adopt that revision.
    await act(async () => root.render(<AutomationEditDialog automation={{ ...task, updatedAtMs: 4 }} language="zh" onClose={close} />));
    const input = document.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'My pending edit');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const save = Array.from(document.querySelectorAll('button')).find(element => element.textContent === '保存')!;
    await act(async () => save.click());
    expect(automationApi.update).toHaveBeenCalledWith('weekly', expect.objectContaining({ expectedRevision: 3, name: task.name, action: expect.objectContaining({ instruction: 'My pending edit' }) }));
    expect(document.body.textContent).toContain('任务已在其他地方更新');
    expect(input.value).toBe('My pending edit');
    expect(close).not.toHaveBeenCalled();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(automationApi.get).mockResolvedValue({ automation: { ...task, updatedAtMs: 4, action: { kind: 'agent', instruction: 'Latest saved content' } } });
    const reload = Array.from(document.querySelectorAll('button')).find(element => element.textContent === '载入最新设置')!;
    await act(async () => reload.click());
    expect(input.value).toBe('Latest saved content');
    vi.mocked(automationApi.update).mockResolvedValue({ automation: task });
    await act(async () => save.click());
    expect(automationApi.update).toHaveBeenLastCalledWith('weekly', expect.objectContaining({ expectedRevision: 4 }));
    expect(close).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
  it('creates a daily task from plain text without requiring a name or showing Markdown tools', async () => {
    const close = vi.fn();
    const created = vi.fn();
    vi.mocked(automationApi.create).mockResolvedValue({ automation: task });
    await act(async () => root.render(<AutomationEditDialog language="zh" projectId="project-1" onClose={close} onCreated={created} />));
    expect(document.body.textContent).toContain('设定定时任务');
    expect(document.activeElement).toBe(document.querySelector('textarea'));
    expect(document.body.textContent).not.toContain('Markdown');
    expect(document.body.textContent).not.toContain('预览');
    expect(document.querySelector('details')?.open).toBe(false);
    const submit = Array.from(document.querySelectorAll('button')).find(element => element.textContent === '创建')!;
    expect(submit.disabled).toBe(true);
    const input = document.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '整理项目进展');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => submit.click());
    expect(automationApi.create).toHaveBeenCalledWith(expect.objectContaining({
      name: '整理项目进展', projectId: 'project-1', enabled: true,
      action: expect.objectContaining({ kind: 'agent', instruction: '整理项目进展' }),
      trigger: { kind: 'schedule', schedule: expect.objectContaining({ kind: 'cron', expr: '0 9 * * *' }) },
    }));
    expect(created).toHaveBeenCalledWith(task);
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects an expired one-time schedule without sending a request', async () => {
    const once = { ...task, trigger: { kind: 'schedule' as const, schedule: { kind: 'once' as const, at: '2020-01-01T09:00:00Z' } } };
    await act(async () => root.render(<AutomationEditDialog automation={once} language="zh" onClose={vi.fn()} />));
    const save = Array.from(document.querySelectorAll('button')).find(element => element.textContent === '保存')!;
    await act(async () => save.click());
    expect(document.body.textContent).toContain('请选择未来的运行时间');
    expect(automationApi.update).not.toHaveBeenCalled();
  });

  it('preserves a one-time date input when another field updates before saving', async () => {
    const once = { ...task, trigger: { kind: 'schedule' as const, schedule: { kind: 'once' as const, at: '2099-01-01T09:00:00Z' } } };
    vi.mocked(automationApi.update).mockResolvedValue({ automation: task });
    await act(async () => root.render(<AutomationEditDialog automation={once} language="zh" onClose={vi.fn()} />));
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    await act(async () => (document.querySelector('[aria-label="运行日期"]') as HTMLButtonElement).click());
    const dateLabel = new Intl.DateTimeFormat('en', { dateStyle: 'full' }).format(new Date(2099, 0, 2, 12));
    const day = Array.from(document.querySelectorAll<HTMLElement>('[role="gridcell"]')).find(element => element.getAttribute('aria-label') === dateLabel)!;
    await act(async () => day.click());
    const description = document.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(description, 'Updated description');
      description.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.querySelector('[aria-label="运行日期"]')?.textContent).toContain('2099');
    await act(async () => Array.from(document.querySelectorAll('button')).find(element => element.textContent === '保存')!.click());
    expect(automationApi.update).toHaveBeenCalledWith(task.id, expect.objectContaining({ trigger: { kind: 'schedule', schedule: { kind: 'once', at: new Date(`2099-01-02T${String(new Date('2099-01-01T09:00:00Z').getHours()).padStart(2, '0')}:00`).toISOString() } } }));
  });

});
