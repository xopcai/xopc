// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { automationApi, type AutomationRun } from '../automation-api';
import { AutomationRunList } from '../automation-run-list';

const run = (id: string): AutomationRun => ({ id, automationId: 'task', automationName: 'Report', status: 'succeeded',
  manual: false, createdAtMs: 1, triggerSnapshot: { kind: 'manual' }, actionSnapshot: { kind: 'agent', instruction: 'Report' } });
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const select = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); });
const render = async (enabled = true, selectedRun?: AutomationRun) => act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
  <AutomationRunList automationId="task" projectId="project" language="en" selectedRun={selectedRun} selectedRunId={selectedRun?.id} enabled={enabled} onSelectRun={select} />
</SWRConfig>));
const click = async (text: string) => act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === text)!.click());

it('lazily fetches scoped history, shows three runs, and follows the server cursor without acknowledging runs', async () => {
  const history = vi.spyOn(automationApi, 'runs').mockImplementation(async (_limit, _id, options) => options?.cursor
    ? { runs: [run('older')], hasMore: false } : { runs: ['newest', 'second', 'third', 'fourth'].map(run), hasMore: true, nextCursor: 'next' });
  const read = vi.spyOn(automationApi, 'markRunRead');
  await render();
  expect(history).toHaveBeenCalledWith(20, 'task', { projectId: 'project', cursor: undefined });
  expect(container.querySelectorAll('button[aria-current]')).toHaveLength(0);
  expect(container.querySelectorAll('button .sr-only')).toHaveLength(3);
  expect(read).not.toHaveBeenCalled();
  await click('View all executions');
  expect(container.querySelectorAll('button .sr-only')).toHaveLength(4);
  await click('Load more');
  expect(history).toHaveBeenCalledWith(20, 'task', { projectId: 'project', cursor: 'next' });
  expect(container.querySelectorAll('button .sr-only')).toHaveLength(5);
  await act(async () => container.querySelector('button')!.click());
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: 'newest' }));
  expect(read).not.toHaveBeenCalled();
});

it('does not fetch collapsed history', async () => {
  const history = vi.spyOn(automationApi, 'runs');
  await render(false);
  expect(history).not.toHaveBeenCalled();
});

it('keeps a deep-linked old run visible outside the recent preview', async () => {
  vi.spyOn(automationApi, 'runs').mockResolvedValue({ runs: ['newest', 'second', 'third'].map(run), hasMore: false });
  await render(true, run('old-deep-link'));
  expect(container.querySelector('[aria-current="true"]')?.textContent).toContain('Currently viewing');
  await act(async () => (container.querySelector('[aria-current="true"]') as HTMLButtonElement).click());
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: 'old-deep-link' }));
});

it('resolves a selected older execution when the sidebar only has its run ID', async () => {
  vi.spyOn(automationApi, 'runs').mockResolvedValue({ runs: ['newest', 'second', 'third'].map(run), hasMore: false });
  const selected = vi.spyOn(automationApi, 'getRun').mockResolvedValue({ run: run('old-execution') });
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <AutomationRunList automationId="task" language="en" selectedRunId="old-execution" onSelectRun={select} />
  </SWRConfig>));
  expect(selected).toHaveBeenCalledWith('old-execution');
  expect(container.querySelector('[aria-current="true"]')?.textContent).toContain('Currently viewing');
});
