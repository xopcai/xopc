// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskDetailPage } from '../task-detail-page';
import { commandTask, type TaskDetail } from '@/features/tasks/home-api';
import { automationApi, type Automation } from '@/features/automations/automation-api';
import { taskCopy } from '@/features/tasks/task-copy';

const state = vi.hoisted(() => ({ detail: {} as TaskDetail, mutate: vi.fn(), automations: [] as Automation[], schedulesLoading: false }));
vi.mock('@/features/tasks/use-task-detail', () => ({ useTaskDetail: () => ({ data: state.detail, mutate: state.mutate }) }));
vi.mock('swr', async () => {
  const { useState } = await import('react');
  return { default: function useMockAutomationList() {
    const [automations, setAutomations] = useState(state.automations);
    return { data: state.schedulesLoading ? undefined : { automations }, mutate: (update: (current: { automations: Automation[] }) => { automations: Automation[] }) => {
      if (typeof update === 'function') setAutomations((current) => update({ automations: current }).automations);
    } };
  } };
});
vi.mock('@/features/automations/automation-api', () => ({ automationApi: { create: vi.fn(), update: vi.fn() } }));
vi.mock('@/features/chat/chat-page', () => ({ ChatPage: () => <div>Execution chat</div> }));
vi.mock('@/features/tasks/task-collaboration-panel', () => ({ TaskCollaborationPanel: () => <textarea aria-label="任务留言" /> }));
vi.mock('@/features/chat/context/page-context-capture-button', () => ({ PageContextCaptureButton: () => <button>Capture context</button> }));
vi.mock('@/features/tasks/task-expandable-content', () => ({ TaskExpandableContent: ({ content, children }: { content: string; children?: ReactNode }) => <div>{children ?? content}</div> }));
vi.mock('@/features/chat/agent-selection/chat-agents-api', () => ({ fetchChatAgents: async () => ({ items: [{ id: 'main', name: 'Main' }] }) }));
vi.mock('@/features/tasks/home-api', () => ({ commandTask: vi.fn(), deleteTask: vi.fn(), handoffTask: vi.fn(), reviewTaskCriterion: vi.fn(), submitTaskFeedback: vi.fn(), updateTask: vi.fn(), updateTaskDependencies: vi.fn(), cancelTaskRun: vi.fn() }));
vi.mock('@/stores/activity-store', () => ({ showActivity: vi.fn() }));
vi.mock('@/stores/locale-store', () => ({ useLocaleStore: (selector: (value: { language: string }) => unknown) => selector({ language: 'zh' }) }));

function detail(): TaskDetail {
  return {
    task: { id: 'task-1', title: 'Prepare report', body: 'Report description', phase: 'ready', priority: 'normal', version: 3, latestContractVersion: 1, updatedAt: 1,
      contract: { objective: 'Research objective', acceptanceCriteria: ['Report saved'], acceptancePolicy: 'manual', expectedOutputs: ['Expected report'] } },
    allowedCommands: ['start', 'mark_ready', 'move'], operationalState: 'idle',
    waits: [], attention: [], runs: [], receipts: [], sessions: [], context: [], dependencies: [], dependents: [], phaseChanges: [], criterionReviews: [],
    conversation: { activeConversationId: 'conversation-1', currentExecutorAgentId: 'main' },
  } as unknown as TaskDetail;
}

describe('task detail action-first layout', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const copy = taskCopy('zh');
  const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === label)!;
  const render = async () => { await act(async () => root.render(<MemoryRouter initialEntries={['/tasks/task-1']}><Routes><Route path="/tasks/:taskId" element={<TaskDetailPage />} /></Routes></MemoryRouter>)); };
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    state.detail = detail();
    state.automations = [];
    state.schedulesLoading = false;
    vi.mocked(commandTask).mockResolvedValue(state.detail);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it('puts current action before results, goal and management and keeps start actionable', async () => {
    await render();
    const text = container.textContent;
    expect(text.indexOf('当前进展')).toBeLessThan(text.indexOf('结果与交付'));
    expect(text.indexOf('结果与交付')).toBeLessThan(text.indexOf('任务目标'));
    expect(text.indexOf('任务目标')).toBeLessThan(text.indexOf('任务管理'));
    await act(async () => button(copy.runTask).click());
    expect(commandTask).toHaveBeenCalledWith('task-1', { type: 'start', executor: { kind: 'agent', agentId: 'main' } }, 3);
    expect(container.querySelector('[aria-label="任务操作"]')?.className).toContain('sticky');
    expect(container.textContent).toContain('Expected report');
    expect(container.textContent).toContain(copy.taskProperties);
    expect(container.textContent).toContain(copy.taskRelations);
    expect(container.querySelector('textarea[aria-label="任务留言"]')).not.toBeNull();
  });

  it('shows questions and submit controls inline without a competing chat link', async () => {
    state.detail.waits = [{ id: 'wait-1', taskId: 'task-1', status: 'active', createdAt: 1, kind: 'user_input', reason: 'Choose audience', condition: { choices: ['Designers'] } }] as TaskDetail['waits'];
    state.detail.attention = [{ kind: 'input_required', summary: 'Choose audience' }] as TaskDetail['attention'];
    state.detail.allowedCommands = ['resolve_wait'];
    await render();
    const current = container.querySelector('[aria-label="当前需要处理"]')!;
    expect(current.textContent).toContain('需要你处理');
    expect(current.querySelector('textarea')).not.toBeNull();
    expect(current.querySelector('a')).toBeNull();
    act(() => button('Designers').click());
    await act(async () => current.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(commandTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ type: 'resolve_wait', resolution: { kind: 'user_answer', answer: 'Designers' } }), 3, expect.any(String));
  });

  it('keeps approval and denial in the first action section', async () => {
    state.detail.waits = [{ id: 'wait-1', taskId: 'task-1', status: 'active', createdAt: 1, kind: 'approval', reason: 'Publish report?', condition: { capability: 'publish' } }] as TaskDetail['waits'];
    state.detail.allowedCommands = ['resolve_wait'];
    await render();
    expect(button('批准').closest('[aria-label="当前需要处理"]')).not.toBeNull();
    await act(async () => button('拒绝并暂停').click());
    expect(commandTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ resolution: { kind: 'task_approval', decision: 'deny' } }), 3, expect.any(String));
  });

  it('routes review to criteria before enabling completion and preserves rerun in More', async () => {
    state.detail.task.phase = 'review'; state.detail.allowedCommands = ['start', 'close'];
    await render();
    expect(button(copy.runTask)).toBeUndefined();
    expect(button(copy.approveTask)).toBeUndefined();
    const acceptance = container.querySelector<HTMLElement>(`[aria-label="${copy.successDefinition}"]`)!;
    acceptance.scrollIntoView = vi.fn();
    act(() => button('去验收').click());
    expect(acceptance.scrollIntoView).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(acceptance);
    const more = container.querySelector<HTMLButtonElement>(`[aria-label="${copy.moreActions}"]`)!;
    act(() => more.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(document.body.textContent).toContain(copy.runTask);
    expect(document.body.textContent).toContain(copy.cancelTask);
    expect(document.body.textContent).toContain(copy.deleteTask);
  });

  it('allows completion only after all criteria passed', async () => {
    state.detail.task.phase = 'review'; state.detail.allowedCommands = ['close'];
    state.detail.criterionReviews = [{ criterionIndex: 0, criterionText: 'Report saved', contractVersion: 1, status: 'passed', reviewedAt: 1 }] as TaskDetail['criterionReviews'];
    await render();
    expect(button('去验收')).toBeUndefined();
    await act(async () => button(copy.approveTask).click());
    expect(commandTask).toHaveBeenCalledWith('task-1', { type: 'close', resolution: 'done' }, 3);
  });

  it('shows a closed summary and view-results action while retaining reopen', async () => {
    state.detail.task.phase = 'closed'; state.detail.allowedCommands = ['reopen'];
    await render();
    expect(container.querySelector('[aria-label="当前需要处理"]')?.textContent).toContain('任务已关闭');
    expect(container.textContent).not.toContain('任务尚未开始');
    expect(button('查看结果')).toBeDefined();
    await act(async () => button(copy.reopenTask).click());
    expect(commandTask).toHaveBeenCalledWith('task-1', { type: 'reopen', phase: 'ready' }, 3);
  });
  it('resumes a paused task while keeping its blocking reason visible', async () => {
    state.detail.waits = [{ id: 'pause-1', taskId: 'task-1', status: 'active', createdAt: 1, kind: 'paused', reason: 'Waiting for revised scope', condition: {} }] as TaskDetail['waits'];
    state.detail.allowedCommands = ['resolve_wait'];
    await render();
    expect(container.querySelector('[aria-label="当前需要处理"]')?.textContent).toContain('Waiting for revised scope');
    await act(async () => button(copy.resumeTask).click());
    expect(commandTask).toHaveBeenCalledWith('task-1', { type: 'resolve_wait', waitId: 'pause-1' }, 3);
  });

  it('retains the chat fallback when the wait cannot be resolved inline', async () => {
    state.detail.waits = [{ id: 'connection-1', taskId: 'task-1', status: 'active', createdAt: 1, kind: 'approval', reason: 'Connect account', condition: { type: 'connection' } }] as TaskDetail['waits'];
    state.detail.attention = [{ kind: 'approval_required', summary: 'Connect your publishing account' }] as TaskDetail['attention'];
    state.detail.allowedCommands = ['resolve_wait'];
    await render();
    const current = container.querySelector('[aria-label="当前需要处理"]')!;
    expect(current.querySelector('form')).toBeNull();
    expect(current.querySelector('a')?.getAttribute('href')).toBe('/chat/task/task-1');
    expect(current.textContent).toContain('Connect your publishing account');
  });

  it('keeps action failures visible in the sticky toolbar', async () => {
    vi.mocked(commandTask).mockRejectedValueOnce(new Error('Conflict'));
    await render();
    await act(async () => button(copy.runTask).click());
    expect(container.querySelector('[aria-label="任务操作"] [role="alert"]')?.textContent).toBe(copy.actionFailed);
  });

  it('opens scheduling in the task page instead of linking to the automation page', async () => {
    await render();
    const schedule = button('设置执行时间');
    expect(schedule.tagName).toBe('BUTTON');
    act(() => schedule.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('input[type="datetime-local"]')).not.toBeNull();
    expect(container.textContent).toContain('Prepare report');
  });

  function savedSchedule(): Automation {
    return {
      id: 'existing-schedule', name: 'Report schedule', enabled: true, updatedAtMs: 42,
      trigger: { kind: 'schedule', schedule: { kind: 'once', at: '2099-10-28T06:30:00.000Z' } },
      action: { kind: 'task_command', taskId: 'task-1', command: { type: 'start', executor: { kind: 'agent', agentId: 'main' } } },
      state: { nextRunAtMs: Date.parse('2099-10-28T06:30:00.000Z') }, delivery: { notificationPolicy: 'attention', destinations: [] }, conversationMode: 'new_session', createdAtMs: 1,
    };
  }

  it('reopens a newly created schedule for editing instead of creating another automation', async () => {
    const saved = savedSchedule();
    vi.mocked(automationApi.create).mockResolvedValue({ automation: saved });
    vi.mocked(automationApi.update).mockResolvedValue({ automation: saved });
    await render(); act(() => button('设置执行时间').click());
    const time = document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(time, '2099-10-28T14:30');
      time.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    const done = [...document.querySelectorAll('button')].find((item) => item.textContent === '完成')!;
    act(() => done.click());
    expect(container.querySelector('[aria-label="执行时间"]')?.textContent).toContain('下次执行：2099');
    expect(button('设置执行时间')).toBeUndefined();
    act(() => button('管理执行时间').click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('修改执行时间');
    await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(automationApi.create).toHaveBeenCalledOnce();
    expect(automationApi.update).toHaveBeenCalledWith(saved.id, expect.objectContaining({ expectedRevision: 42 }));
  });

  it('loads saved schedules on revisit and cancellation updates the card without navigation', async () => {
    const saved = savedSchedule(); state.automations = [saved];
    vi.mocked(automationApi.update).mockResolvedValue({ automation: { ...saved, enabled: false } });
    await render();
    expect(button('设置执行时间')).toBeUndefined();
    expect(button('管理执行时间')).toBeDefined();
    await act(async () => button('取消定时执行').click());
    expect(container.textContent).toContain('已取消，不再自动执行');
    expect(button('设置执行时间')).toBeUndefined();
    expect(automationApi.create).not.toHaveBeenCalled();
  });

  it('blocks creation before existing schedules have loaded', async () => {
    state.schedulesLoading = true; await render();
    expect(button('设置执行时间').disabled).toBe(true);
    act(() => button('设置执行时间').click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

});
