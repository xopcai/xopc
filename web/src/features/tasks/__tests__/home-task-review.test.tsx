// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commandTask, fetchTask, reviewTaskCriterion, type TaskDetail } from '../home-api';
import { HomeTaskReview } from '../home-task-review';

vi.mock('@/features/workspace/workspace-file-preview-dialog', () => ({ WorkspaceFilePreviewPanel: ({ filePath, projectId, conversationId, onClose }: { filePath: string; projectId: string; conversationId: string; onClose: () => void }) => <div data-preview-file={filePath} data-preview-project={projectId} data-preview-conversation={conversationId}><button onClick={onClose}>Close preview</button></div> }));

vi.mock('../home-api', () => ({ commandTask: vi.fn(), fetchTask: vi.fn(), reviewTaskCriterion: vi.fn() }));
vi.mock('../task-expandable-content', () => ({ TaskExpandableContent: ({ content, children }: { content: string; children?: ReactNode }) => <div>{children ?? content}</div> }));

function detail(reviewed = false): TaskDetail {
  return {
    task: { id: 'task-1', projectId: 'project-1', phase: 'review', version: reviewed ? 4 : 3, latestContractVersion: 1,
      contract: { acceptanceCriteria: ['Report saved'], acceptancePolicy: 'manual' } },
    allowedCommands: ['close'], waits: [], runs: [], receipts: [], conversation: { activeConversationId: 'conversation-1' },
    criterionReviews: reviewed ? [{ criterionIndex: 0, contractVersion: 1, criterionText: 'Report saved', status: 'passed' }] : [],
  } as unknown as TaskDetail;
}

describe('HomeTaskReview', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  const button = (label: string) => Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label)!;

  it('requires criterion review before accepting and refreshes after completion', async () => {
    vi.mocked(fetchTask).mockResolvedValue(detail());
    vi.mocked(reviewTaskCriterion).mockResolvedValue(detail(true));
    vi.mocked(commandTask).mockResolvedValue(detail(true));
    const complete = vi.fn();
    await act(async () => root.render(<MemoryRouter><HomeTaskReview taskId="task-1" language="zh" onComplete={complete} /></MemoryRouter>));
    expect(button('验收完成').disabled).toBe(true);
    await act(async () => button('确认通过').click());
    expect(reviewTaskCriterion).toHaveBeenCalledWith('task-1', 0, 'passed', 3, 1);
    expect(button('验收完成').disabled).toBe(false);
    await act(async () => button('验收完成').click());
    expect(commandTask).toHaveBeenCalledWith('task-1', { type: 'close', resolution: 'done' }, 4);
    expect(complete).toHaveBeenCalledOnce();
  });

  it('keeps a failed acceptance visible without reporting completion', async () => {
    vi.mocked(fetchTask).mockResolvedValue(detail(true));
    vi.mocked(commandTask).mockRejectedValue(new Error('Task version changed'));
    const complete = vi.fn();
    await act(async () => root.render(<MemoryRouter><HomeTaskReview taskId="task-1" language="en" onComplete={complete} /></MemoryRouter>));
    await act(async () => button('Accept task').click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Task version changed');
    expect(complete).not.toHaveBeenCalled();
  });
  function automaticDetail(): TaskDetail {
    const value = detail();
    value.task.contract!.acceptancePolicy = 'verified_auto';
    value.allowedCommands = ['start', 'close'];
    value.runs = [{ id: 'run-1', taskId: 'task-1', rootRunId: 'run-1', attempt: 1, status: 'succeeded', contractVersion: 1, queuedAt: 1, executorKind: 'agent', executorRef: { agentId: 'main' }, trigger: {}, correlationId: 'c1', idempotencyKey: 'key-1', retryPolicy: {}, version: 1 }] as TaskDetail['runs'];
    value.receipts = [{ runId: 'run-1', finalizedAt: 2, summary: 'Report generated', remainingWork: ['Verify delivery'],
      nextAction: 'Open the report and verify its contents', completionVerdict: 'partial',
      evidence: [{ kind: 'artifact', title: 'Open report', uri: 'reports/report.html', summary: 'Saved HTML', strength: 'observed', provenance: 'tool' }],
      verification: { status: 'unverified', checks: [{ criterion: 'Report saved', status: 'unverified', evidenceTitles: ['Open report'], note: 'Only a file path was returned.' }] },
    }] as TaskDetail['receipts'];
    return value;
  }

  it('opens local evidence and lets automatic review continue execution without bypassing verification', async () => {
    const value = automaticDetail();
    vi.mocked(fetchTask).mockResolvedValue(value);
    vi.mocked(commandTask).mockResolvedValue({ ...value, task: { ...value.task, phase: 'active', version: 4 }, allowedCommands: [] });
    const onUpdated = vi.fn();
    await act(async () => root.render(<MemoryRouter><HomeTaskReview taskId="task-1" language="zh" onComplete={vi.fn()} onUpdated={onUpdated} /></MemoryRouter>));
    expect(container.textContent).toContain('Only a file path was returned.');
    expect(container.textContent).toContain('Verify delivery');
    expect(container.textContent).toContain('Open the report and verify its contents');
    expect(button('确认通过')).toBeUndefined();
    expect(button('验收完成').disabled).toBe(true);
    await act(async () => button('Open report').click());
    expect(document.querySelector('[role="dialog"] [data-preview-file]')?.getAttribute('data-preview-file')).toBe('reports/report.html');
    expect(document.querySelector('[data-preview-file]')?.getAttribute('data-preview-project')).toBe('project-1');
    expect(document.querySelector('[data-preview-file]')?.getAttribute('data-preview-conversation')).toBe('conversation-1');
    await act(async () => [...document.querySelectorAll('button')].find((item) => item.textContent === 'Close preview')!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => button('继续执行并验证').click());
    expect(commandTask).toHaveBeenCalledWith('task-1', { type: 'start', executor: { kind: 'agent', agentId: 'main' } }, 3);
    expect(onUpdated).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('已开始执行');
    expect(button('验收完成')).toBeUndefined();
  });

  it('shows the wait question and saves the answer on the home card', async () => {
    const value = detail(true);
    value.allowedCommands = ['resolve_wait', 'close'];
    value.waits = [{ id: 'wait-1', taskId: 'task-1', status: 'active', createdAt: 1, kind: 'user_input', reason: 'Need recipient', condition: { question: 'Who should receive the report?' } }] as TaskDetail['waits'];
    vi.mocked(fetchTask).mockResolvedValue(value);
    vi.mocked(commandTask).mockResolvedValue({ ...value, waits: [] });
    const onUpdated = vi.fn();
    await act(async () => root.render(<MemoryRouter><HomeTaskReview taskId="task-1" language="en" onComplete={vi.fn()} onUpdated={onUpdated} /></MemoryRouter>));
    expect(button('Accept task').disabled).toBe(true);
    expect(container.textContent).toContain('Who should receive the report?');
    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Alice');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Submit answer').click());
    expect(commandTask).toHaveBeenCalledWith('task-1', { type: 'resolve_wait', waitId: 'wait-1', resolution: { kind: 'user_answer', answer: 'Alice' } }, 4, expect.any(String));
    expect(onUpdated).toHaveBeenCalledOnce();
    expect(button('Accept task').disabled).toBe(false);
  });

  it('ignores historical results and refreshes only for this task', async () => {
    const value = automaticDetail();
    value.task.latestContractVersion = 2;
    vi.mocked(fetchTask).mockResolvedValue(value);
    await act(async () => root.render(<MemoryRouter><HomeTaskReview taskId="task-1" language="en" onComplete={vi.fn()} /></MemoryRouter>));
    expect(container.textContent).not.toContain('Report generated');
    expect(container.textContent).toContain('No result for the current task version');
    await act(async () => window.dispatchEvent(new CustomEvent('task-changed-v2', { detail: { taskId: 'another-task' } })));
    expect(fetchTask).toHaveBeenCalledTimes(1);
    await act(async () => window.dispatchEvent(new CustomEvent('task-changed-v2', { detail: { taskId: 'task-1' } })));
    expect(fetchTask).toHaveBeenCalledTimes(2);
  });

  it('does not let an older refresh overwrite a criterion review', async () => {
    let resolveRefresh!: (value: TaskDetail) => void;
    vi.mocked(fetchTask).mockResolvedValueOnce(detail()).mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    vi.mocked(reviewTaskCriterion).mockResolvedValue(detail(true));
    await act(async () => root.render(<MemoryRouter><HomeTaskReview taskId="task-1" language="en" onComplete={vi.fn()} /></MemoryRouter>));
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => button('Mark passed').click());
    await act(async () => resolveRefresh(detail()));
    expect(button('Accept task').disabled).toBe(false);
  });

});
