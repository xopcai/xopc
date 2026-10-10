// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { fetchHome, type HomeResponse } from '../home-api';
import { useHomeSnapshot } from '../use-home-snapshot';

vi.mock('../home-api', () => ({ fetchHome: vi.fn() }));

const snapshot = (needsAttention: boolean): HomeResponse => ({
  needsUser: needsAttention ? [{
    id: 'task:failed', kind: 'decision', title: 'Retry task', summary: 'Run failed',
    updatedAt: 1, secondaryActions: [],
  }] : [],
  background: [], backgroundCount: 0, runningConversations: [], decisions: [],
  advisor: { state: 'quiet', reason: 'no_change' },
  attentionPolicy: {
    visibleDecisionCount: needsAttention ? 1 : 0, suppressedDecisionCount: 0,
    visibleAttentionCount: 0, suppressedAttentionCount: 0,
  },
});

let root: Root;
let container: HTMLDivElement;
let current: ReturnType<typeof useHomeSnapshot>;
function Probe({ navigationKey = 'home' }: { navigationKey?: string }) {
  current = useHomeSnapshot('zh', navigationKey);
  return <span>{current.home?.needsUser.length}</span>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(fetchHome).mockResolvedValue(snapshot(true));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

it('removes a resolved reminder when returning from the task overlay without remounting', async () => {
  await act(async () => root.render(<Probe />));
  expect(container.textContent).toBe('1');
  await act(async () => root.render(<Probe navigationKey="task-overlay" />));
  vi.mocked(fetchHome).mockResolvedValue(snapshot(false));
  await act(async () => root.render(<Probe navigationKey="return-home" />));
  expect(container.textContent).toBe('0');
  expect(fetchHome).toHaveBeenCalledTimes(3);
});

it.each(['task-changed-v2', 'task-updated', 'gateway-realtime-connected', 'realtime-gap', 'focus'])(
  'refreshes the workbench after %s', async (name) => {
    await act(async () => root.render(<Probe />));
    vi.mocked(fetchHome).mockResolvedValue(snapshot(false));
    await act(async () => {
      window.dispatchEvent(new Event(name));
      vi.advanceTimersByTime(100);
    });
    expect(container.textContent).toBe('0');
  },
);

it('keeps task updates prompt during a burst of transcript events', async () => {
  await act(async () => root.render(<Probe />));
  vi.mocked(fetchHome).mockResolvedValue(snapshot(false));
  await act(async () => {
    window.dispatchEvent(new Event('task-changed-v2'));
    for (let index = 0; index < 5; index++) {
      window.dispatchEvent(new Event('session-transcript-updated'));
    }
    vi.advanceTimersByTime(100);
  });
  expect(fetchHome).toHaveBeenCalledTimes(2);
  expect(container.textContent).toBe('0');
});

it.each(['snapshot', 'error'])('ignores an older %s arriving after the latest state', async (outcome) => {
  let resolve!: (value: HomeResponse) => void;
  let reject!: (error: Error) => void;
  vi.mocked(fetchHome).mockReturnValueOnce(new Promise((res, rej) => { resolve = res; reject = rej; }));
  await act(async () => root.render(<Probe />));
  vi.mocked(fetchHome).mockResolvedValue(snapshot(false));
  await act(async () => current.load());
  await act(async () => {
    if (outcome === 'snapshot') resolve(snapshot(true));
    else reject(new Error('Old request failed'));
  });
  expect(container.textContent).toBe('0');
  expect(current.loadError).toBeNull();
});

it('cleans up queued refreshes when leaving the workbench', async () => {
  await act(async () => root.render(<Probe />));
  window.dispatchEvent(new Event('task-changed-v2'));
  await act(async () => root.unmount());
  window.dispatchEvent(new Event('focus'));
  await act(async () => vi.advanceTimersByTime(1000));
  expect(fetchHome).toHaveBeenCalledOnce();
});
