// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commandTask, fetchTask, reviewTaskCriterion, type TaskDetail } from '../home-api';
import { HomeTaskReview } from '../home-task-review';

vi.mock('../home-api', () => ({ commandTask: vi.fn(), fetchTask: vi.fn(), reviewTaskCriterion: vi.fn() }));
vi.mock('../task-expandable-content', () => ({ TaskExpandableContent: ({ content }: { content: string }) => <p>{content}</p> }));

function detail(reviewed = false): TaskDetail {
  return {
    task: { phase: 'review', version: reviewed ? 4 : 3, latestContractVersion: 1,
      contract: { acceptanceCriteria: ['Report saved'], acceptancePolicy: 'manual' } },
    allowedCommands: ['close'], waits: [], runs: [], receipts: [],
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
    await act(async () => root.render(<HomeTaskReview taskId="task-1" language="zh" onComplete={complete} />));
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
    await act(async () => root.render(<HomeTaskReview taskId="task-1" language="en" onComplete={complete} />));
    await act(async () => button('Accept task').click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Task version changed');
    expect(complete).not.toHaveBeenCalled();
  });
});
