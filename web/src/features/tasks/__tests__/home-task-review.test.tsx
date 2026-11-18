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
    presentation: { status: 'review', primaryAction: { type: 'review' } },
    acceptanceTarget: { id: 'run-1', runId: 'run-1', canSignOff: reviewed },
    criterionReviews: reviewed ? [{ checkId: 'task-1:1:0', criterionIndex: 0, contractVersion: 1, criterionText: 'Report saved', status: 'passed' }] : [],
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
  const dialog = () => document.querySelector('[role="dialog"]:not([aria-hidden="true"])')!;
  const button = (label: string) => Array.from(dialog().querySelectorAll('button')).find((item) => item.textContent === label)!;

  it('requires a separate sign-off after saving the last criterion', async () => {
    vi.mocked(fetchTask).mockResolvedValue(detail());
    const closed = detail(true);
    closed.task = { ...closed.task, phase: 'closed', resolution: 'done' };
    vi.mocked(reviewTaskCriterion).mockResolvedValue(detail(true));
    vi.mocked(commandTask).mockResolvedValue(closed);
    const complete = vi.fn();
    await act(async () => root.render(<MemoryRouter><HomeTaskReview taskId="task-1" onClose={vi.fn()} language="zh" onComplete={complete} /></MemoryRouter>));
    expect(button('确认验收').disabled).toBe(true);
    await act(async () => button('确认通过').click());
    expect(reviewTaskCriterion).toHaveBeenCalledWith('task-1', 'task-1:1:0', 'passed', 3, 1, 'run-1');
    expect(button('确认验收').disabled).toBe(false);
    expect(commandTask).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    await act(async () => button('确认验收').click());
    expect(commandTask).toHaveBeenCalledWith('task-1', { type: 'signoff', resultId: 'run-1' }, 4);
    expect(complete).toHaveBeenCalledOnce();
  });

  it('keeps a failed acceptance visible without reporting completion', async () => {
    vi.mocked(fetchTask).mockResolvedValue(detail(true));
    vi.mocked(commandTask).mockRejectedValue(new Error('Task version changed'));
    const complete = vi.fn();
    await act(async () => root.render(<MemoryRouter><HomeTaskReview taskId="task-1" onClose={vi.fn()} language="en" onComplete={complete} /></MemoryRouter>));
    await act(async () => button('Accept task').click());
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('Task version changed');
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
      verification: { status: 'unverified', checks: [{ checkId: 'task-1:1:0', criterion: 'Report saved', status: 'unverified', evidenceTitles: ['Open report'], note: 'Only a file path was returned.' }] },
    }] as TaskDetail['receipts'];
    return value;
  }

  it('opens local evidence and lets automatic review continue execution without bypassing verification', async () => {
    const value = automaticDetail();
    vi.mocked(fetchTask).mockResolvedValue(value);
    vi.mocked(commandTask).mockResolvedValue({ ...value, task: { ...value.task, phase: 'active', version: 4 }, allowedCommands: [] });
    const onUpdated = vi.fn();
    await act(async () => root.render(<MemoryRouter><HomeTaskReview taskId="task-1" onClose={vi.fn()} language="zh" onComplete={vi.fn()} onUpdated={onUpdated} /></MemoryRouter>));
    expect(dialog().textContent).toContain('Only a file path was returned.');
    expect(dialog().textContent).toContain('Verify delivery');
    expect(dialog().textContent).toContain('Open the report and verify its contents');
    expect(button('确认通过')).toBeUndefined();
    expect(button('确认验收').disabled).toBe(true);
    await act(async () => button('Open report').click());
    expect(document.querySelector('[role="dialog"] [data-preview-file]')?.getAttribute('data-preview-file')).toBe('reports/report.html');
    expect(document.querySelector('[data-preview-file]')?.getAttribute('data-preview-project')).toBe('project-1');
    expect(document.querySelector('[data-preview-file]')?.getAttribute('data-preview-conversation')).toBe('conversation-1');
    await act(async () => [...document.querySelectorAll('button')].find((item) => item.textContent === 'Close preview')!.click());
    expect(document.querySelector('[data-preview-file]')).toBeNull();
    expect(dialog().textContent).toContain('Verify delivery');
    await act(async () => button('继续执行并验证').click());
    expect(commandTask).toHaveBeenCalledWith('task-1', { type: 'start', executor: { kind: 'agent', agentId: 'main' } }, 3);
    expect(onUpdated).toHaveBeenCalledOnce();
    expect(dialog().querySelector('[role="status"]')?.textContent).toContain('已开始执行');
    expect(button('确认验收')).toBeUndefined();
  });

  it('explains a legacy model setup blocker and translates internal gaps without treating them as a partial result', async () => {
    const value = automaticDetail();
    value.task.phase = 'active';
    value.receipts[0] = {
      ...value.receipts[0],
      status: 'failed',
      summary: JSON.stringify({
        kind: 'provider_setup_required',
        code: 'provider_setup_required',
        provider: 'qwen-token-plan-cn',
        deepLink: '/unexpected',
        message: 'No API key found for qwen-token-plan-cn.\nSee /Users/example/node_modules/agent/docs/providers.md',
      }),
      remainingWork: [
        'The required evidence-linked research result is missing. Submit actual sources and claims for review.',
        'The requested chat reply is missing. Submit the exact user-facing text in finalText for review.',
        'Criterion 0: 带来源链接。. 没有收到可核对的来源。',
      ],
      nextAction: undefined,
      completionVerdict: 'not_achieved',
      failure: { code: 'agent_run_failed', phase: 'execution', recoveryAction: 'Retry with another model' },
      evidence: [],
    };
    vi.mocked(fetchTask).mockResolvedValue(value);

    await act(async () => root.render(<MemoryRouter><HomeTaskReview taskId="task-1" onClose={vi.fn()} language="zh" /></MemoryRouter>));
    const modal = dialog();
    expect(modal.textContent).toContain('模型服务商未配置');
    expect(modal.textContent).toContain('阿里云百炼订阅');
    expect(modal.textContent).toContain('缺少可核对的来源和结论');
    expect(modal.textContent).toContain('还没有生成可在对话中查看的答复');
    expect(modal.textContent).toContain('没有收到可核对的来源');
    expect(modal.textContent).toContain('1 项待核验');
    expect(modal.textContent).not.toMatch(/provider_setup_required|node_modules|finalText|Criterion 0|阶段性结果/);
    expect([...modal.querySelectorAll('a')].find((link) => link.textContent === '打开模型设置')?.getAttribute('href')).toBe('/settings/capabilities/models');
    expect(button('重试任务')).toBeTruthy();
  });

  it('shows the wait question and saves the answer in the result dialog', async () => {
    const value = detail(true);
    value.acceptanceTarget = { id: 'run-1', runId: 'run-1', canSignOff: false };
    value.allowedCommands = ['resolve_wait', 'close'];
    value.waits = [{ id: 'wait-1', taskId: 'task-1', status: 'active', createdAt: 1, kind: 'user_input', reason: 'Need recipient', condition: { question: 'Who should receive the report?' } }] as TaskDetail['waits'];
    vi.mocked(fetchTask).mockResolvedValue(value);
    vi.mocked(commandTask).mockResolvedValue({ ...value, waits: [], acceptanceTarget: { id: 'run-1', runId: 'run-1', canSignOff: true } });
    const onUpdated = vi.fn();
    await act(async () => root.render(<MemoryRouter><HomeTaskReview taskId="task-1" onClose={vi.fn()} language="en" onComplete={vi.fn()} onUpdated={onUpdated} /></MemoryRouter>));
    expect(button('Accept task').disabled).toBe(true);
    expect(dialog().textContent).toContain('Who should receive the report?');
    const textarea = dialog().querySelector('textarea')!;
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
    await act(async () => root.render(<MemoryRouter><HomeTaskReview taskId="task-1" onClose={vi.fn()} language="en" onComplete={vi.fn()} /></MemoryRouter>));
    expect(dialog().textContent).not.toContain('Report generated');
    expect(dialog().textContent).toContain('No result for the current task version');
    await act(async () => window.dispatchEvent(new CustomEvent('task-changed-v2', { detail: { taskId: 'another-task' } })));
    expect(fetchTask).toHaveBeenCalledTimes(1);
    await act(async () => window.dispatchEvent(new CustomEvent('task-changed-v2', { detail: { taskId: 'task-1' } })));
    expect(fetchTask).toHaveBeenCalledTimes(2);
  });

  it('does not let an older refresh overwrite a criterion review', async () => {
    let resolveRefresh!: (value: TaskDetail) => void;
    vi.mocked(fetchTask).mockResolvedValueOnce(detail()).mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    vi.mocked(reviewTaskCriterion).mockResolvedValue(detail(true));
    await act(async () => root.render(<MemoryRouter><HomeTaskReview taskId="task-1" onClose={vi.fn()} language="en" onComplete={vi.fn()} /></MemoryRouter>));
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => button('Mark passed').click());
    await act(async () => resolveRefresh(detail()));
    expect(button('Accept task').disabled).toBe(false);
  });

});
