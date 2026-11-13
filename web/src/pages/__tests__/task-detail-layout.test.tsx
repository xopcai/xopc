// @vitest-environment jsdom
import { act, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskDetailPage } from '../task-detail-page';
import { TaskDetailModal } from '@/features/tasks/task-detail-modal';
import { commandTask, reviewTaskCriterion, type TaskDetail } from '@/features/tasks/home-api';
import { automationApi, type Automation } from '@/features/automations/automation-api';
import { taskCopy } from '@/features/tasks/task-copy';

const state = vi.hoisted(() => ({ detail: {} as TaskDetail, mutate: vi.fn(), automations: [] as Automation[], schedulesLoading: false }));
vi.mock('@/components/ui/date-time-picker', () => ({
  DateTimePicker: ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) =>
    <input aria-label={label} data-test-date-time-picker value={value} onChange={event => onChange(event.target.value)} />,
}));
vi.mock('@/features/tasks/use-task-detail', () => ({
  useTaskDetail: () => ({ data: state.detail, mutate: state.mutate }),
  useTaskDetailQuery: vi.fn(),
}));
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
    presentation: { status: 'ready', primaryAction: { type: 'start' } },
    acceptanceTarget: { id: 'run-1', runId: 'run-1', canSignOff: false },
    waits: [], attention: [], runs: [], receipts: [], sessions: [], context: [], dependencies: [], dependents: [], phaseChanges: [], criterionReviews: [],
    conversation: { activeConversationId: 'conversation-1', currentExecutorAgentId: 'main' },
  } as unknown as TaskDetail;
}

describe('task detail action-first layout', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const copy = taskCopy('zh');
  const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === label)!;
  const checkbox = () => container.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  const render = async () => { await act(async () => root.render(<MemoryRouter initialEntries={['/tasks/task-1']}><Routes><Route path="/tasks/:taskId" element={<TaskDetailPage />} /></Routes></MemoryRouter>)); };
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    state.mutate.mockResolvedValue(undefined);
    vi.mocked(reviewTaskCriterion).mockReset();
    state.detail = detail();
    state.automations = [];
    state.schedulesLoading = false;
    vi.mocked(commandTask).mockResolvedValue(state.detail);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it('puts current action before results, goal and management and keeps start actionable', async () => {
    await render();
    const text = container.querySelector('.task-detail-scroll > section')!.textContent;
    expect(text.indexOf('当前进展')).toBeLessThan(text.indexOf('交付结果'));
    expect(text.indexOf('交付结果')).toBeLessThan(text.indexOf('任务目标'));
    expect(text.indexOf('任务目标')).toBeLessThan(text.indexOf('任务管理'));
    await act(async () => button(copy.runTask).click());
    expect(commandTask).toHaveBeenCalledWith('task-1', { type: 'start', executor: { kind: 'agent', agentId: 'main' } }, 3);
    expect(container.querySelector('[aria-label="任务操作"]')?.className).toContain('sticky');
    expect(container.textContent).toContain('Expected report');
    expect(container.textContent).toContain(copy.taskProperties);
    expect(container.textContent).toContain(copy.taskRelations);
    expect(container.querySelector('textarea[aria-label="任务留言"]')).not.toBeNull();
  });

  it('renders Markdown in current progress when the latest run failed', async () => {
    const summary = '[查看报告](https://example.com/report)\n\n**建议：**优先选择宁海。\n\n| 方案 | 交通 |\n| --- | --- |\n| 宁海 | 高铁 |';
    state.detail.presentation = { status: 'failed', reason: summary };
    state.detail.attention = [{ kind: 'run_failed', summary }];
    await render();

    const progress = container.querySelector('[aria-label="当前需要处理"]')!;
    expect(progress.querySelector('h2')?.textContent).toBe('当前进展');
    expect(progress.querySelector('a')?.getAttribute('href')).toBe('https://example.com/report');
    expect(progress.querySelector('strong')?.textContent).toBe('建议：');
    expect(progress.querySelector('table tbody td')?.textContent).toBe('宁海');
  });

  it('moves the task name into the dialog header after the large title scrolls away', async () => {
    let update: ((isIntersecting: boolean, bottom: number) => void) | undefined;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        if (target.matches('.task-detail-scroll > header')) {
          update = (isIntersecting, bottom) => this.callback([
            { isIntersecting, boundingClientRect: { bottom } } as IntersectionObserverEntry,
          ], this as unknown as IntersectionObserver);
        }
      }
      unobserve() {}
      disconnect() {}
    });
    try {
      await act(async () => root.render(<MemoryRouter><TaskDetailModal taskId="task-1" backgroundPath="/tasks" onClose={vi.fn()} /></MemoryRouter>));
      const header = document.querySelector('[data-task-header-compact]')!;
      expect(header.getAttribute('data-task-header-compact')).toBe('false');
      act(() => update!(false, 80));
      expect(header.getAttribute('data-task-header-compact')).toBe('false');
      act(() => update!(false, -1));
      expect(header.getAttribute('data-task-header-compact')).toBe('true');
      expect(header.querySelector('[aria-hidden="false"]')?.textContent).toBe('Prepare report');
      act(() => update!(true, 80));
      expect(header.getAttribute('data-task-header-compact')).toBe('false');
      expect(header.querySelector('[aria-hidden="false"]')?.textContent).toBe('任务详情');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('opens with the selected title and waits until the entrance finishes to mount details', async () => {
    let finishEntrance!: () => void;
    const finished = new Promise<void>((resolve) => { finishEntrance = resolve; });
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
      configurable: true,
      value: () => [{ animationName: 'task-detail-enter', finished }],
    });
    try {
      await act(async () => root.render(<MemoryRouter><TaskDetailModal taskId="task-1" initialTitle="Prepare report" backgroundPath="/personal" onClose={vi.fn()} /></MemoryRouter>));
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog.querySelector('[data-task-header-compact]')?.textContent).toBe('Prepare report');
      expect(dialog.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(dialog.querySelector('.task-detail-scroll')).toBeNull();

      await act(async () => finishEntrance());
      expect(dialog.querySelector('.task-detail-scroll')).not.toBeNull();
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations');
    }
  });

  it('opens a collapsed section from navigation and supports repeated clicks', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    try {
      await render();
      const report = container.querySelector<HTMLDetailsElement>('[data-task-section="report"]')!;
      report.scrollIntoView = vi.fn();
      act(() => report.querySelector('summary')!.click());
      expect(report.open).toBe(false);
      const nav = container.querySelector('nav[aria-label="任务详情分区"]')!;
      const reportButton = [...nav.querySelectorAll('button')].find(item => item.textContent === '执行报告')!;
      act(() => reportButton.click());
      expect(report.open).toBe(true);
      expect(report.scrollIntoView).toHaveBeenLastCalledWith({ block: 'start', behavior: 'instant' });
      expect(reportButton.getAttribute('aria-current')).toBe('location');
      act(() => reportButton.click());
      expect(report.scrollIntoView).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); }
  });

  it('keeps the clicked label stable and waits for scrolling to finish before navigating', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const locations: string[] = [];
    function LocationProbe() {
      const location = useLocation();
      useEffect(() => { locations.push(location.search); }, [location]);
      return null;
    }
    try {
      await act(async () => root.render(<MemoryRouter initialEntries={['/tasks/task-1']}><LocationProbe /><Routes><Route path="/tasks/:taskId" element={<TaskDetailPage />} /></Routes></MemoryRouter>));
      const pane = container.querySelector<HTMLElement>('.task-detail-scroll')!;
      const targets = [...pane.querySelectorAll<HTMLElement>('[data-task-section]')];
      targets.forEach((target, index) => {
        target.getBoundingClientRect = () => ({ top: index === 0 ? -10 : 500 }) as DOMRect;
        target.scrollIntoView = vi.fn();
      });
      const nav = container.querySelector('nav[aria-label="任务详情分区"]')!;
      const goal = [...nav.querySelectorAll('button')].find(item => item.textContent === '目标说明')!;
      act(() => goal.click());
      expect(locations).toEqual(['']);
      act(() => { pane.dispatchEvent(new Event('scroll')); frame?.(0); });
      expect(goal.getAttribute('aria-current')).toBe('location');
      expect(locations).toEqual(['']);
      act(() => pane.dispatchEvent(new Event('scrollend')));
      expect(locations).toHaveLength(2);
      expect(locations[1]).toContain('taskSection=goal');
      act(() => { pane.dispatchEvent(new Event('scroll')); frame?.(0); });
      expect(nav.querySelector('[aria-current="location"]')?.textContent).toBe('交付结果');
      expect(locations).toHaveLength(2);
      act(() => vi.advanceTimersByTime(160));
      expect(locations).toHaveLength(3);
      expect(locations[2]).toContain('taskSection=results');
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
  });

  it('tracks manual scrolling without scrolling the section again', async () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    try {
      await render();
      const pane = container.querySelector<HTMLElement>('.task-detail-scroll')!;
      const targets = [...pane.querySelectorAll<HTMLElement>('[data-task-section]')];
      targets.forEach((target, index) => {
        target.getBoundingClientRect = () => ({ top: index <= 3 ? -10 : 500 }) as DOMRect;
        target.scrollIntoView = vi.fn();
      });
      act(() => { pane.dispatchEvent(new Event('scroll')); frame?.(0); });
      const current = container.querySelector('nav [aria-current="location"]');
      expect(current?.textContent).toBe('目标说明');
      targets.forEach(target => expect(target.scrollIntoView).not.toHaveBeenCalled());
    } finally { vi.unstubAllGlobals(); }
  });

  it('shows questions and submit controls inline without a competing chat link', async () => {
    state.detail.presentation = { status: 'needsUser', primaryAction: { type: 'resolve_wait', waitId: 'wait-1' } };
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
    state.detail.presentation = { status: 'needsUser', primaryAction: { type: 'resolve_wait', waitId: 'wait-1' } };
    state.detail.waits = [{ id: 'wait-1', taskId: 'task-1', status: 'active', createdAt: 1, kind: 'approval', reason: 'Publish report?', condition: { capability: 'publish' } }] as TaskDetail['waits'];
    state.detail.allowedCommands = ['resolve_wait'];
    await render();
    expect(button('批准').closest('[aria-label="当前需要处理"]')).not.toBeNull();
    await act(async () => button('拒绝并暂停').click());
    expect(commandTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ resolution: { kind: 'task_approval', decision: 'deny' } }), 3, expect.any(String));
  });

  it('routes review to criteria before enabling completion and preserves rerun in More', async () => {
    state.detail.presentation = { status: 'review', primaryAction: { type: 'review' } };
    state.detail.task.phase = 'review'; state.detail.allowedCommands = ['start', 'close'];
    await render();
    expect(button(copy.runTask)).toBeUndefined();
    expect(button('完成任务')).toBeUndefined();
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

  it('requires explicit sign-off after the last checkbox', async () => {
    state.detail.task.phase = 'review';
    state.detail.task.contract!.acceptancePolicy = 'manual';
    state.detail.allowedCommands = ['close'];
    vi.mocked(reviewTaskCriterion).mockImplementation(async (_taskId, _index, status) => {
      state.detail = { ...state.detail, task: { ...state.detail.task, version: 4 },
        presentation: { status: 'review', primaryAction: { type: 'signoff', resultId: 'run-1' } },
        acceptanceTarget: { id: 'run-1', runId: 'run-1', canSignOff: true },
        criterionReviews: [{ checkId: 'task-1:1:0', criterionIndex: 0, criterionText: 'Report saved', contractVersion: 1,
          status, reviewedBy: { kind: 'user', id: 'owner' }, reviewedAt: 1 }] };
      return state.detail;
    });
    await render();
    expect(button('完成任务')).toBeUndefined();
    expect(checkbox().checked).toBe(false);
    await act(async () => checkbox().click());
    expect(reviewTaskCriterion).toHaveBeenCalledWith('task-1', 'task-1:1:0', 'passed', 3, 1, 'run-1');
    await render();
    expect(checkbox().checked).toBe(true);
    expect(checkbox().disabled).toBe(false);
    expect(commandTask).not.toHaveBeenCalled();
    await act(async () => button('确认验收').click());
    expect(commandTask).toHaveBeenCalledWith('task-1', { type: 'signoff', resultId: 'run-1' }, 4);
  });

  it('keeps criterion checkboxes read-only for closed tasks', async () => {
    state.detail.task.phase = 'closed';
    await render();
    expect(checkbox().disabled).toBe(true);
    await act(async () => checkbox().click());
    expect(reviewTaskCriterion).not.toHaveBeenCalled();
  });

  it('keeps main sections readable while collapsing detailed evidence', async () => {
    state.detail.presentation = { status: 'needsUser', reason: 'Choose internal or public release',
      primaryAction: { type: 'inspect_run', runId: 'run-1' } };
    state.detail.task.phase = 'review';
    state.detail.allowedCommands = ['close', 'add_wait', 'start'];
    state.detail.task.contract!.acceptanceCriteria = ['Report saved', 'Evidence checked'];
    state.detail.runs = [{ id: 'run-1', contractVersion: 1, status: 'succeeded' }] as TaskDetail['runs'];
    const note = 'Default criteria were not expanded into concrete acceptance items; broad completion cannot certify item coverage.';
    state.detail.receipts = [{ runId: 'run-1', status: 'succeeded', summary: 'Claim c-ac0-scope: Full report with detailed reasoning',
      finalizedAt: 1, completionVerdict: 'partial', needsUser: true, remainingWork: ['Confirm the public release scope'], nextAction: 'Choose internal or public release',
      evidence: [{ kind: 'source', title: 'Research claim: c-file', summary: 'Source details', provenance: 'judge', strength: 'observed' }],
      verification: { status: 'unverified', checks: state.detail.task.contract!.acceptanceCriteria.map((criterion, index) => ({ criterion, checkId: `task-1:1:${index}`,
        status: 'unverified', evidenceTitles: ['Research claim: c-file'], method: 'model_reviewed', note })) } }] as TaskDetail['receipts'];
    await render();
    const report = [...container.querySelectorAll('summary')].find((item) => item.textContent === '完整执行报告')!.parentElement as HTMLDetailsElement;
    expect(report.open).toBe(true);
    expect(report.textContent).toContain('Full report with detailed reasoning');
    expect(report.textContent).toContain(copy.doneWell);
    const management = container.querySelector<HTMLDetailsElement>('[aria-label="任务管理"]')!;
    expect(management.open).toBe(true);
    const followUp = container.querySelector('[aria-label="执行待办"]')!;
    expect(followUp.textContent).toContain('Confirm the public release scope');
    expect(followUp.textContent).toContain('Choose internal or public release');
    expect(followUp.querySelector('a')?.getAttribute('href')).toBe('/chat/task/task-1');
    const acceptance = container.querySelector(`[aria-label="${copy.successDefinition}"]`)!;
    expect(acceptance.querySelector('[aria-live=polite]')?.textContent).toBe('0/2');
    expect(acceptance.textContent.split(note)).toHaveLength(2);
    const evidencePanels = [...acceptance.querySelectorAll('li > details > summary')];
    expect(evidencePanels).toHaveLength(2);
    expect(evidencePanels.map(item => item.textContent)).toEqual(['Report saved', 'Evidence checked']);
    for (const summary of evidencePanels) expect((summary.parentElement as HTMLDetailsElement).open).toBe(false);
    const toolbar = container.querySelector('[aria-label="任务操作"]')!;
    expect(toolbar.textContent).not.toContain('去验收');
    expect(toolbar.textContent).toContain('查看待处理事项');
    expect(toolbar.textContent).not.toContain(copy.pauseTask);
    expect(toolbar.textContent).not.toContain('设置执行时间');
    await act(async () => evidencePanels[0].querySelector('span[id]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(reviewTaskCriterion).not.toHaveBeenCalled();
    expect((evidencePanels[0].parentElement as HTMLDetailsElement).open).toBe(true);
    expect((evidencePanels[1].parentElement as HTMLDetailsElement).open).toBe(false);
  });

  it('allows changing a human decision and keeps save failures beside acceptance', async () => {
    state.detail.task.phase = 'review';
    state.detail.allowedCommands = ['close'];
    state.detail.criterionReviews = [{ checkId: 'task-1:1:0', criterionIndex: 0, criterionText: 'Report saved', contractVersion: 1,
      status: 'passed', reviewedAt: 1 }] as TaskDetail['criterionReviews'];
    vi.mocked(reviewTaskCriterion).mockRejectedValueOnce(new Error('Conflict'));
    await render();
    await act(async () => checkbox().click());
    expect(reviewTaskCriterion).toHaveBeenCalledWith('task-1', 'task-1:1:0', 'unverified', 3, 1, 'run-1');
    expect(container.querySelector(`[aria-label="${copy.successDefinition}"] [role="alert"]`)?.textContent).toBe(copy.actionFailed);
    expect(checkbox().checked).toBe(true);
    expect(commandTask).not.toHaveBeenCalled();
  });

  it('shows a closed summary and view-results action while retaining reopen', async () => {
    state.detail.presentation = { status: 'ended', primaryAction: { type: 'view_results' } };
    state.detail.task.phase = 'closed'; state.detail.allowedCommands = ['reopen'];
    await render();
    expect(container.querySelector('[aria-label="当前需要处理"]')?.textContent).toContain('任务已关闭');
    expect(container.textContent).not.toContain('任务尚未开始');
    expect(button('查看结果')).toBeDefined();
    await act(async () => button(copy.reopenTask).click());
    expect(commandTask).toHaveBeenCalledWith('task-1', { type: 'reopen', phase: 'ready' }, 3);
  });
  it('resumes a paused task while keeping its blocking reason visible', async () => {
    state.detail.presentation = { status: 'paused', primaryAction: { type: 'resume', waitId: 'pause-1' } };
    state.detail.waits = [{ id: 'pause-1', taskId: 'task-1', status: 'active', createdAt: 1, kind: 'paused', reason: 'Waiting for revised scope', condition: {} }] as TaskDetail['waits'];
    state.detail.allowedCommands = ['resolve_wait'];
    await render();
    expect(container.querySelector('[aria-label="当前需要处理"]')?.textContent).toContain('Waiting for revised scope');
    await act(async () => button(copy.resumeTask).click());
    expect(commandTask).toHaveBeenCalledWith('task-1', { type: 'resolve_wait', waitId: 'pause-1' }, 3);
  });

  it('retains the chat fallback when the wait cannot be resolved inline', async () => {
    state.detail.presentation = { status: 'needsUser', primaryAction: { type: 'resolve_wait', waitId: 'connection-1' } };
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
    expect(document.querySelector('input[data-test-date-time-picker]')).not.toBeNull();
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
    const time = document.querySelector<HTMLInputElement>('input[data-test-date-time-picker]')!;
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
