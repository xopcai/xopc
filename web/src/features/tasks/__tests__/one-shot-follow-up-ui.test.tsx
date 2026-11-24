// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TaskDetail } from '../home-api';
import { TaskCurrentAction } from '../task-current-action';

const fetchJson = vi.hoisted(() => vi.fn());
const fetchTaskMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/fetch', () => ({ fetchJson }));
vi.mock('../home-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../home-api')>();
  return { ...actual, fetchTask: fetchTaskMock };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FOLLOW_UP_ID = '11111111-2222-4333-8444-555555555555';
const OUTREACH_ID = '22222222-3333-4444-8555-666666666666';

function makeDetail(overrides?: Partial<TaskDetail>): TaskDetail {
  return {
    ok: true,
    phaseChanges: [],
    task: {
      id: 'task-pilot',
      title: '移动端试点发布看板',
      phase: 'active',
      priority: 'high',
      source: 'user',
      version: 3,
      latestContractVersion: 1,
      createdAt: 1_000,
      updatedAt: 2_000,
      contract: {
        version: 1,
        objective: '确定试点发布范围',
        acceptanceCriteria: ['确认试点范围'],
        acceptancePolicy: 'manual',
        constraints: [],
        createdBy: { kind: 'user' },
        createdAt: 1_000,
      },
    },
    operationalState: 'waiting',
    presentation: {
      status: 'needsUser',
      reason: '需要确认本周试点范围',
      primaryAction: { type: 'resolve_wait', waitId: 'wait-scope' },
    },
    attention: [{ kind: 'input_required', summary: '需要确认本周试点范围', sourceId: 'wait-scope' }],
    waits: [{
      id: 'wait-scope',
      taskId: 'task-pilot',
      kind: 'user_input',
      status: 'active',
      reason: '需要确认本周试点范围',
      condition: { question: '请选择 iOS 先发还是双端同发', choices: ['iOS 先发', '双端同发'] },
      createdAt: 1_500,
    }],
    runs: [],
    receipts: [],
    criterionReviews: [],
    acceptanceChecks: [],
    results: [],
    context: [],
    conversation: { taskId: 'task-pilot', assignmentEpoch: 1, updatedAt: 1_000 },
    sessions: [],
    authorityGrants: [],
    dependencies: [],
    dependents: [],
    allowedCommands: ['resolve_wait'],
    oneShotFollowUps: [{
      followUpId: FOLLOW_UP_ID,
      status: 'completed',
      displayState: 'delivered',
      revision: 2,
      subject: '移动端试点发布看板',
      summary: '请选择 iOS 先发还是双端同发',
      taskId: 'task-pilot',
      taskTitle: '移动端试点发布看板',
      projectId: null,
      waitId: 'wait-scope',
      waitKind: 'user_input',
      waitSummary: '请选择 iOS 先发还是双端同发',
      destination: 'workbench',
      timezone: 'Asia/Shanghai',
      checkAt: Date.parse('2026-11-27T16:00:00+08:00'),
      validUntil: Date.parse('2026-11-27T17:00:00+08:00'),
      lastCheckedAt: Date.parse('2026-11-27T16:00:00+08:00'),
      lastCheckError: null,
      terminalReason: 'delivered',
      conversationId: '33333333-4444-4555-8666-777777777777',
      outreach: {
        outreachId: OUTREACH_ID,
        state: 'published',
        destination: 'workbench',
        text: '「移动端试点发布看板」仍需你确认或补充决定：请选择 iOS 先发还是双端同发。',
        publishedAt: Date.parse('2026-11-27T16:00:00+08:00'),
        acknowledgedAt: null,
      },
      sourcesAvailable: true,
      sources: [{
        conversationId: '33333333-4444-4555-8666-777777777777',
        transcriptId: 'transcript-1',
        entryId: 'entry-1',
        excerpt: '周五 16:00 如果还需要我定试点范围就放工作台提醒我',
      }],
      createdAt: 1_600,
      updatedAt: 2_000,
    }],
    ...overrides,
  } as TaskDetail;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach(fn => fn());
  vi.clearAllMocks();
});

function LocationProbe({ onLocation }: { onLocation: (loc: { pathname: string; state: unknown }) => void }) {
  const location = useLocation();
  onLocation({ pathname: location.pathname, state: location.state });
  return null;
}

describe('Workbench TaskCurrentAction one-shot follow-up integration', () => {
  it('renders workbench unread reminder banner separately from TaskWait input, acknowledges it idempotently, and navigates to Personal with task contextRef without sending', async () => {
    const detail = makeDetail();
    const onUpdated = vi.fn();
    let latestLocation: { pathname: string; state: unknown } = { pathname: '/tasks/task-pilot', state: null };

    fetchTaskMock.mockResolvedValue(
      makeDetail({
        oneShotFollowUps: [{
          ...detail.oneShotFollowUps![0],
          outreach: { ...detail.oneShotFollowUps![0].outreach!, acknowledgedAt: 9_999 },
        }],
      }),
    );
    fetchJson.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/home/attention/acknowledge') && init?.method === 'POST') {
        return { ok: true, status: 'acknowledged' };
      }
      return { ok: true, payload: detail.oneShotFollowUps![0] };
    });

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/tasks/task-pilot']}>
          <LocationProbe onLocation={loc => { latestLocation = loc; }} />
          <TaskCurrentAction detail={detail} language="zh" onUpdated={onUpdated} />
        </MemoryRouter>,
      );
    });
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });

    // Both the distinct unread workbench follow-up banner AND the original TaskInputCard are rendered
    expect(container.querySelector('[data-workbench-followup-unread]')?.textContent).toContain('约定提醒已到达');
    expect(container.textContent).toContain('条件跟进：已提醒 · 跟进结束');
    expect(container.textContent).toContain('请选择 iOS 先发还是双端同发');

    // Acknowledge the workbench reminder -> calls /api/home/attention/acknowledge with outreachId
    const ackBtn = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('知道了'))!;
    await act(async () => {
      ackBtn.click();
    });
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining('/api/home/attention/acknowledge'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ kind: 'one_shot_follow_up', outreachId: OUTREACH_ID }),
      }),
    );
    expect(onUpdated).toHaveBeenCalledTimes(1);

    // Click "和助手讨论" -> navigates to /personal carrying kind='task' contextRef without posting any session input
    fetchJson.mockClear();
    const discussBtn = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('和助手讨论'))!;
    act(() => {
      discussBtn.click();
    });
    expect(latestLocation.pathname).toBe('/personal');
    expect(latestLocation.state).toEqual({
      attachTaskContext: {
        kind: 'task',
        sourceId: 'task-pilot',
        expectedVersion: '3',
        title: '移动端试点发布看板',
      },
    });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('stops a queued active follow-up from Workbench and displays honest feedback when already delivered', async () => {
    const activeDetail = makeDetail({
      oneShotFollowUps: [{
        ...makeDetail().oneShotFollowUps![0],
        status: 'active',
        displayState: 'queued_delivery',
        revision: 1,
        terminalReason: null,
        outreach: {
          outreachId: OUTREACH_ID,
          state: 'ready',
          destination: 'personal',
          text: '待发送提醒',
          publishedAt: null,
          acknowledgedAt: null,
        },
      }],
    });
    const onUpdated = vi.fn();
    fetchTaskMock.mockResolvedValue(makeDetail());
    fetchJson.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes(`/api/personal-agent/attention/${FOLLOW_UP_ID}/stop`) && init?.method === 'POST') {
        return {
          ok: true,
          payload: {
            outcome: 'already_delivered',
            followUp: makeDetail().oneShotFollowUps![0],
          },
        };
      }
      return makeDetail();
    });

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter>
          <TaskCurrentAction detail={activeDetail} language="zh" onUpdated={onUpdated} />
        </MemoryRouter>,
      );
    });
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });

    expect(container.textContent).toContain('等待送达');
    const stopBtn = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('停止跟进'))!;
    await act(async () => {
      stopBtn.click();
    });
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining(`/api/personal-agent/attention/${FOLLOW_UP_ID}/stop`),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(container.textContent).toContain('已提醒，跟进已结束。');
  });
});
