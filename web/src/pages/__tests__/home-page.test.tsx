// @vitest-environment jsdom
import type { HomeResponse } from '@xopcai/gateway-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), retry: vi.fn(), acknowledge: vi.fn(), decision: vi.fn(), fetchTask: vi.fn(),
  home: {} as HomeResponse,
}));
vi.mock('@/features/tasks/use-home-snapshot', () => ({ useHomeSnapshot: () => ({ home: mocks.home, loading: false, loadError: null, setLoadError: vi.fn(), load: mocks.load }) }));
vi.mock('@/features/tasks/home-api', () => ({ retryWorkAttention: mocks.retry, acknowledgeWorkAttention: mocks.acknowledge, respondToWorkDecision: mocks.decision, fetchTask: mocks.fetchTask }));
vi.mock('@/features/tasks/home-quick-composer', () => ({ HomeQuickComposer: () => null }));
vi.mock('@/features/tasks/home-advisor-card', () => ({ HomeAdvisorCard: () => null }));
vi.mock('@/features/tasks/home-advisor-status-control', () => ({ HomeAdvisorStatusControl: () => null }));
vi.mock('@/features/tasks/home-advisor-history-dialog', () => ({ HomeAdvisorHistoryDialog: () => null }));
vi.mock('@/features/voice/realtime/use-realtime-voice', () => ({ useRealtimeVoice: () => ({ phase: 'idle', voiceActive: false }) }));
vi.mock('@/features/chat/composer/use-composer-attachments', () => ({ useComposerAttachments: () => ({ attachments: [], fileInputRef: { current: null } }) }));

import { HomePage } from '../home-page';
import { useLocaleStore } from '@/stores/locale-store';

function LocationProbe() {
  const location = useLocation();
  return <output>{location.pathname}{location.search}</output>;
}

describe('home card actions', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'en' });
    mocks.home = { needsUser: [], background: [], backgroundCount: 0, runningConversations: [], decisions: [], advisor: { state: 'disabled' } } as unknown as HomeResponse;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  const button = (text: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === text)!;
  const render = () => act(async () => root.render(<MemoryRouter><HomePage /><LocationProbe /></MemoryRouter>));

  it('makes every background item reachable beyond the initial three', async () => {
    mocks.home.background = Array.from({ length: 4 }, (_, index) => ({ id: `schedule-${index}`, kind: 'scheduled', title: `Schedule ${index}`, summary: 'Scheduled', updatedAt: 1, secondaryActions: [], openAction: { type: 'open', label: 'View schedule', href: `/automations?automation=${index}` } }));
    mocks.home.backgroundCount = 4;
    await render();
    expect(container.textContent).not.toContain('Schedule 3');
    await act(async () => button('View all 4 items').click());
    expect(container.textContent).toContain('Schedule 3');
    const row = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('Schedule 3'))!;
    await act(async () => row.click());
    expect(container.querySelector('output')?.textContent).toBe('/automations?automation=3');
  });

  it('shows a retry receipt and follows the new run conversation', async () => {
    mocks.home.needsUser = [{ id: 'failed-1', kind: 'failure', title: 'Daily report failed', summary: 'Timed out', updatedAt: 1, secondaryActions: [], primaryAction: { type: 'retry_run', label: 'Retry', subjectKind: 'automation_run', runId: 'old-run' }, openAction: { type: 'open', label: 'Details', href: '/automations?run=old-run' } }];
    mocks.retry.mockResolvedValue({ ok: true, runId: 'new-run', conversationId: 'new-conversation' });
    await render();
    await act(async () => button('Retry').click());
    expect(mocks.retry).toHaveBeenCalledWith({ kind: 'automation_run', runId: 'old-run' });
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Retry started');
    await act(async () => button('View progress and result').click());
    expect(container.querySelector('output')?.textContent).toBe('/chat/new-conversation');
  });

  it('opens task results inline for input decisions and keeps details available', async () => {
    mocks.home.needsUser = [{ id: 'task:task-1', kind: 'decision', title: 'Complete report', summary: 'Need input', updatedAt: 1, secondaryActions: [], primaryAction: { type: 'open', label: 'Review task', href: '/tasks/task-1' }, openAction: { type: 'open', label: 'Review task', href: '/tasks/task-1' } }];
    mocks.fetchTask.mockResolvedValue({ task: { id: 'task-1', phase: 'active', latestContractVersion: 1 }, allowedCommands: [], waits: [], runs: [], receipts: [], criterionReviews: [] });
    await render();
    await act(async () => button('Review task').click());
    expect(mocks.fetchTask).toHaveBeenCalledWith('task-1');
    expect(container.querySelector('output')?.textContent).toBe('/?reviewTask=task-1');
    expect(container.textContent).toContain('No result for the current task version');
    const details = [...container.querySelectorAll('a')].find((item) => item.textContent === 'Task details')!;
    expect(details).not.toBeNull();
    expect(details.getAttribute('href')).toBe('/?reviewTask=task-1&task=task-1');
    await act(async () => details.click());
    expect(container.querySelector('output')?.textContent).toBe('/?reviewTask=task-1&task=task-1');
  });
});
