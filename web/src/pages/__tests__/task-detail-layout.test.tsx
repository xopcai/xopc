// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskDetailPage } from '../task-detail-page';
import { commandTask, type TaskDetail } from '@/features/tasks/home-api';
import { taskCopy } from '@/features/tasks/task-copy';

const state = vi.hoisted(() => ({ detail: {} as TaskDetail, mutate: vi.fn() }));
vi.mock('@/features/tasks/use-task-detail', () => ({ useTaskDetail: () => ({ data: state.detail, mutate: state.mutate }) }));
vi.mock('swr', () => ({ default: () => ({ data: { automations: [] } }) }));
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

});
