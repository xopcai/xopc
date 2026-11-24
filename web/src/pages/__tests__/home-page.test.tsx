// @vitest-environment jsdom
import type { HomeResponse } from '@xopcai/gateway-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), retry: vi.fn(), acknowledge: vi.fn(), decision: vi.fn(), fetchTask: vi.fn(),
  getRun: vi.fn(), markRunRead: vi.fn(),
  home: {} as HomeResponse,
  proactive: {
    items: [] as Array<Record<string, unknown>>,
    digests: [] as Array<Record<string, unknown>>,
    bufferedCount: 0,
    rsiCandidates: [] as Array<Record<string, unknown>>,
    metrics: null,
    loading: false,
    reload: vi.fn(async () => {}),
  },
}));
vi.mock('@/features/tasks/use-home-snapshot', () => ({ useHomeSnapshot: () => ({ home: mocks.home, loading: false, loadError: null, setLoadError: vi.fn(), load: mocks.load }) }));
vi.mock('@/features/proactive/use-proactive-inbox', () => ({ useProactiveInbox: () => mocks.proactive }));
vi.mock('@/features/tasks/home-api', () => ({ retryWorkAttention: mocks.retry, acknowledgeWorkAttention: mocks.acknowledge, respondToWorkDecision: mocks.decision, fetchTask: mocks.fetchTask }));
vi.mock('@/features/automations/automation-api', () => ({ automationApi: { getRun: mocks.getRun, markRunRead: mocks.markRunRead } }));
vi.mock('@/features/tasks/home-quick-composer', () => ({ HomeQuickComposer: ({ variant }: { variant: string }) => <div data-composer={variant} /> }));
vi.mock('@/features/tasks/home-advisor-card', () => ({ HomeAdvisorCard: () => null }));
vi.mock('@/features/tasks/home-advisor-status-control', () => ({ HomeAdvisorStatusControl: () => null }));
vi.mock('@/features/tasks/home-advisor-history-dialog', () => ({ HomeAdvisorHistoryDialog: () => null }));
vi.mock('@/features/voice/realtime/use-realtime-voice', () => ({ useRealtimeVoice: () => ({ phase: 'idle', voiceActive: false }) }));
vi.mock('@/features/chat/composer/use-composer-attachments', () => ({ useComposerAttachments: () => ({ attachments: [], fileInputRef: { current: null } }) }));

import { HomePage } from '../home-page';
import { useLocaleStore } from '@/stores/locale-store';

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  return <>
    <output>{location.pathname}{location.search}</output>
    {params.has('task') ? <button onClick={() => {
      params.delete('task');
      navigate(`/?${params}`, { replace: true });
    }}>Close task detail route</button> : null}
  </>;
}

describe('home card actions', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'en' });
    mocks.proactive = {
      items: [],
      digests: [],
      bufferedCount: 0,
      rsiCandidates: [],
      metrics: null,
      loading: false,
      reload: vi.fn(async () => {}),
    };
    mocks.home = { needsUser: [], background: [], backgroundCount: 0, runningConversations: [], decisions: [], advisor: { state: 'disabled' } } as unknown as HomeResponse;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  const button = (text: string, scope: ParentNode = container) => [...scope.querySelectorAll('button')].find((item) => item.textContent === text)!;
  const dialog = () => document.querySelector<HTMLDivElement>('[role="dialog"]:not([aria-hidden="true"])')!;
  const render = () => act(async () => root.render(<MemoryRouter><HomePage /><LocationProbe /></MemoryRouter>));

  it('promotes the unread delivery after resolving the last item and opens the idle composer after reading it', async () => {
    mocks.home.needsUser = [{
      id: 'approval-1', kind: 'decision', title: 'Send the quote', summary: 'Mail · send\nTo: purchasing',
      updatedAt: 1, secondaryActions: [],
      primaryAction: { type: 'connector_decision', label: 'Allow and continue', approvalId: 'approval-1', decision: 'approve' },
    }];
    mocks.home.recentDeliveries = [{
      id: 'automation:weekly-report', kind: 'automation', subjectId: 'weekly-report',
      title: 'Department weekly report', summary: 'Three projects', completedAt: Date.now(), read: false,
      href: '/automations?view=run&run=weekly-report',
    }];
    mocks.decision.mockResolvedValue({ ok: true });
    mocks.load.mockImplementation(async () => { mocks.home = { ...mocks.home, needsUser: [] }; });
    mocks.getRun.mockResolvedValue({ run: { summary: 'Three projects' } });
    mocks.markRunRead.mockResolvedValue({ marked: true });
    const headings = () => [...container.querySelectorAll('h2')].map((heading) => heading.textContent);
    await render();
    expect(headings()[0]).toBe('Needs attention');
    expect(button('Allow and continue')).toBeUndefined();
    await act(async () => button('Review authorization').click());
    expect(container.textContent).not.toContain('To: purchasing');
    expect(dialog().textContent).toContain('To: purchasing');
    await act(async () => button('Allow and continue', dialog()).click());
    expect(dialog()).toBeNull();
    expect(headings()[0]).toBe('Recent results');
    await act(async () => button('Open result').click());
    const markRead = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((item) => item.textContent === 'Done reading, back to workbench')!;
    expect(markRead.disabled).toBe(false);
    await act(async () => markRead.click());
    expect(mocks.markRunRead).toHaveBeenCalledWith('weekly-report');
    expect(headings()[0]).toBe('What do you want to get done?');
    expect(container.querySelector('[data-composer="inline"]')).toBeTruthy();
    await act(async () => button('Result history').click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Department weekly report');
  });

  it('makes every background item reachable beyond the initial three', async () => {
    mocks.home.background = Array.from({ length: 4 }, (_, index) => ({ id: `schedule-${index}`, kind: 'scheduled', title: `Schedule ${index}`, summary: 'Scheduled', updatedAt: 1, secondaryActions: [], openAction: { type: 'open', label: 'View schedule', href: `/automations?automation=${index}` } }));
    mocks.home.backgroundCount = 4;
    await render();
    expect(container.textContent).not.toContain('Schedule 3');
    await act(async () => button('View all 4 items').click());
    expect(container.textContent).not.toContain('Schedule 3');
    expect(dialog().textContent).toContain('Schedule 3');
    const row = [...dialog().querySelectorAll('button')].find((item) => item.textContent?.includes('Schedule 3'))!;
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

  it('opens a task decision in a modal and restores the result after viewing details', async () => {
    mocks.home.needsUser = [{ id: 'task:task-1', kind: 'decision', title: 'Complete report', summary: 'Need input', updatedAt: 1, secondaryActions: [], primaryAction: { type: 'open', label: 'Review task', href: '/tasks/task-1' }, openAction: { type: 'open', label: 'Review task', href: '/tasks/task-1' } }];
    mocks.fetchTask.mockResolvedValue({ task: { id: 'task-1', phase: 'active', latestContractVersion: 1 }, allowedCommands: [], waits: [], runs: [], receipts: [], criterionReviews: [] });
    await render();
    const trigger = button('Review task');
    await act(async () => trigger.click());
    expect(mocks.fetchTask).toHaveBeenCalledWith('task-1');
    expect(container.querySelector('output')?.textContent).toBe('/?reviewTask=task-1');
    expect(container.textContent).not.toContain('No result for the current task version');
    expect(dialog().textContent).toContain('No result for the current task version');
    const details = [...dialog().querySelectorAll('a')].find((item) => item.textContent === 'Task details')!;
    expect(details).not.toBeNull();
    expect(details.getAttribute('href')).toBe('/?reviewTask=task-1&task=task-1');
    await act(async () => details.click());
    expect(container.querySelector('output')?.textContent).toBe('/?reviewTask=task-1&task=task-1');
    expect(dialog()).toBeNull();
    await act(async () => button('Close task detail route').click());
    expect(dialog().textContent).toContain('No result for the current task version');
    await act(async () => dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(dialog()).toBeNull();
    expect(container.querySelector('output')?.textContent).toBe('/');
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('opens the result and evidence for a retryable item in the pending list without expanding the card', async () => {
    mocks.home.needsUser = Array.from({ length: 3 }, (_, index) => ({
      id: `task:task-${index}`, kind: 'failure', title: `Report ${index}`, summary: 'Partial result', updatedAt: 1,
      secondaryActions: [], primaryAction: { type: 'retry_task', label: 'Retry', taskId: `task-${index}` },
    }));
    mocks.fetchTask.mockResolvedValue({ task: { id: 'task-2', title: 'Report 2', phase: 'active', latestContractVersion: 1 }, allowedCommands: [], waits: [], runs: [], receipts: [], criterionReviews: [] });
    await render();
    await act(async () => button('View 1 more pending items').click());
    const row = [...dialog().querySelectorAll('article')].find((item) => item.textContent?.includes('Report 2'))!;
    const trigger = button('View result and evidence', row);
    await act(async () => trigger.click());
    expect(dialog().textContent).toContain('Report 2');
    expect(dialog().textContent).toContain('No result for the current task version');
    expect(container.textContent).not.toContain('Report 2');
    expect(mocks.fetchTask).toHaveBeenCalledOnce();
    await act(async () => dialog().querySelector<HTMLAnchorElement>('a')!.click());
    expect(container.querySelector('output')?.textContent).toBe('/?reviewTask=task-2&task=task-2');
    await act(async () => button('Close task detail route').click());
    expect(dialog().textContent).toContain('No result for the current task version');
    await act(async () => dialog().querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    expect(dialog().textContent).toContain('Report 2');
    expect(dialog().textContent).not.toContain('No result for the current task version');
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('hides cold-start clutter on an empty idle workbench until the user has work history', async () => {
    mocks.home.observation = {
      status: 'disabled',
      revision: 0,
      analyzedRevision: 0,
      lastProcessedAt: null,
      hasWorkHistory: false,
      topics: [],
    };
    await render();
    expect(container.textContent).toContain('What do you want to get done?');
    expect(button('Search projects and conversations')).toBeTruthy();
    expect(container.textContent).not.toContain('Nothing needs your attention right now');
    expect(button('Result history')).toBeUndefined();
    expect(container.textContent).not.toContain('Let me handle it');
    expect(button('Find recurring work')).toBeUndefined();

    mocks.home = {
      ...mocks.home,
      observation: { ...mocks.home.observation, hasWorkHistory: true },
    };
    await render();
    expect(container.textContent).toContain('Let me handle it');
    expect(button('Find recurring work')).toBeTruthy();
  });

  it('keeps the no-attention status when non-idle work is present', async () => {
    mocks.home.resumable = [{
      id: 'conv-1',
      kind: 'conversation',
      title: 'Weekly sync',
      updatedAt: Date.now(),
      href: '/chat/conv-1',
    }];
    await render();
    expect(container.textContent).toContain('Nothing needs your attention right now');
  });

  it('converges external proactive signals into a compact summary strip and opens full inbox in a modal without inline button clutter', async () => {
    mocks.proactive.items = [{
      id: 'ext-mail-1',
      ownerId: 'local-owner',
      agentId: 'personal-local-owner',
      coalesceKey: 'mail:1',
      sourceEventIds: ['ev-1'],
      tier: 'tier_a_inbox',
      category: 'prepared_draft',
      title: 'Partner contract payment terms draft',
      summary: 'Prepared a 45-day payment term reply draft.',
      provenance: {
        source: 'composio:gmail',
        eventType: 'connector.mail.received',
        trust: 'connector',
        coalescedCount: 1,
        reason: 'Partner legal requested confirmation',
        evidenceRefs: ['event:ev-1'],
        score: { actionability: 3, urgency: 2, novelty: 2, preparedness: 2, disruptionPenalty: 0, netScore: 9 },
      },
      proposedAction: { kind: 'approve_draft', safetyMode: 'ask_before_apply', label: 'Approve' },
      state: 'ready',
      validUntil: Date.now() + 86_400_000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];

    await render();
    const strip = container.querySelector('[data-proactive-inbox-strip]');
    expect(strip?.textContent).toContain('External Signal Inbox');
    expect(strip?.textContent).toContain('Partner contract payment terms draft');
    // Main workbench canvas does NOT render inline Review & Edit / Approve / To Digest buttons
    expect(button('Review & Edit')).toBeUndefined();
    expect(button('To Digest')).toBeUndefined();

    await act(async () => button('Open inbox').click());
    expect(dialog().textContent).toContain('Agent Inbox · External Signals');
    expect(dialog().textContent).toContain('Prepared a 45-day payment term reply draft.');
  });
});
