// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  actOnProactiveItem: vi.fn(),
  flushProactiveDigest: vi.fn(),
  adoptRsiCandidate: vi.fn(),
  rollbackRsiCandidate: vi.fn(),
}));

vi.mock('../proactive-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../proactive-api')>();
  return {
    ...actual,
    actOnProactiveItem: apiMocks.actOnProactiveItem,
    flushProactiveDigest: apiMocks.flushProactiveDigest,
    adoptRsiCandidate: apiMocks.adoptRsiCandidate,
    rollbackRsiCandidate: apiMocks.rollbackRsiCandidate,
  };
});

import { ProactiveInboxCard } from '../proactive-inbox-card';
import type { ProactiveHubMetrics, ProactiveItem, RsiCapabilityCandidate } from '../proactive-api';

const METRICS: ProactiveHubMetrics = {
  activeSubscriptions: 9,
  bufferingSignals: 0,
  droppedSignalsTotal: 42,
  inboxPendingCount: 1,
  chatEscalatedCount: 0,
  digestBufferedCount: 2,
  actedCount: 3,
  mutedCount: 1,
};

const SAMPLE_ITEM: ProactiveItem = {
  id: 'item-draft-1',
  ownerId: 'local-owner',
  agentId: 'personal-local-owner',
  coalesceKey: 'mail:contract-1',
  sourceEventIds: ['ev-1'],
  tier: 'tier_a_inbox',
  category: 'prepared_draft',
  title: 'Q4 合同条款确认草稿',
  summary: '已核对付款周期变更并准备好回复草稿。',
  provenance: {
    source: 'composio:gmail',
    eventType: 'connector.mail.received',
    trust: 'connector',
    coalescedCount: 1,
    reason: '合作方法务等待账期拍板',
    evidenceRefs: ['event:ev-1'],
    score: {
      actionability: 3,
      urgency: 2,
      novelty: 2,
      preparedness: 2,
      disruptionPenalty: 0,
      netScore: 10,
    },
  },
  preparedPayload: {
    verifiedFacts: ['账期由 30 天调整为 45 天'],
    evidenceRefs: ['event:ev-1'],
    preparedDraft: '同意调整为 45 天账期。',
  },
  proposedAction: {
    kind: 'approve_draft',
    safetyMode: 'ask_before_apply',
    label: '采纳回复',
  },
  state: 'ready',
  validUntil: Date.now() + 86_400_000,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const SAMPLE_RSI: RsiCapabilityCandidate = {
  id: 'rsi-skill-1',
  artifactKind: 'skill',
  targetId: 'contract-reply-standard',
  scopeType: 'workspace',
  triggerKind: 'human_edit_diff',
  sourceRefs: ['proactive_item:item-draft-1'],
  simRationale: {
    problemPattern: '合同回复缺少滞纳金保留声明',
    whyChanged: '根据用户编辑差异补充法务边界条款',
    applicabilityConditions: ['商务合同账期确认'],
    negativeConstraints: ['不适用于日常内部沟通'],
  },
  verificationStatus: 'passed',
  status: 'adopted',
  adoptedVersion: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe('ProactiveInboxCard inline draft editing, Pulse digest flush, and RSI rollback', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const reload = vi.fn(async () => {});

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('opens the fixed-size review modal, submits edit_and_approve when draft changes, and manages Pulse + RSI rollback', async () => {
    apiMocks.actOnProactiveItem.mockResolvedValue({ ...SAMPLE_ITEM, state: 'acted' });
    apiMocks.flushProactiveDigest.mockResolvedValue({
      ...SAMPLE_ITEM,
      id: 'pulse-1',
      category: 'pulse_digest',
      title: '脉冲简报（共 2 项动态）',
    });
    apiMocks.rollbackRsiCandidate.mockResolvedValue({ ...SAMPLE_RSI, status: 'rolled_back' });

    await act(async () => {
      root.render(
        <ProactiveInboxCard
          items={[SAMPLE_ITEM]}
          digests={[]}
          bufferedCount={2}
          rsiCandidates={[SAMPLE_RSI]}
          metrics={METRICS}
          loading={false}
          language="zh"
          onReload={reload}
        />,
      );
    });

    expect(container.textContent).toContain('主动收件箱');
    expect(container.textContent).toContain('Q4 合同条款确认草稿');
    expect(container.textContent).toContain('2 待聚合动态');

    // Open review modal and edit prepared draft
    const reviewBtn = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('审阅与处理'))!;
    await act(async () => reviewBtn.click());

    const dialog = document.querySelector<HTMLDivElement>('[role="dialog"]')!;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('合作方法务等待账期拍板');

    const textarea = dialog.querySelector<HTMLTextAreaElement>('textarea#proactive-draft-editor')!;
    expect(textarea.value).toBe('同意调整为 45 天账期。');

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '同意调整为 45 天账期，但逾期滞纳金条款保持不变。');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const saveEditBtn = [...dialog.querySelectorAll('button')].find(b => b.textContent?.includes('保存修改并执行'))!;
    expect(saveEditBtn).toBeTruthy();
    await act(async () => saveEditBtn.click());

    expect(apiMocks.actOnProactiveItem).toHaveBeenCalledWith(
      'item-draft-1',
      expect.objectContaining({
        action: 'edit_and_approve',
        editedDraft: '同意调整为 45 天账期，但逾期滞纳金条款保持不变。',
      }),
    );
    expect(reload).toHaveBeenCalledTimes(1);

    // Open Pulse & RSI drawer -> flush digest + rollback RSI skill
    const pulseBtn = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('脉冲简报与能力库'))!;
    await act(async () => pulseBtn.click());

    const drawer = document.querySelector<HTMLDivElement>('[role="dialog"]')!;
    const flushBtn = [...drawer.querySelectorAll('button')].find(b => b.textContent?.includes('立即合成当期简报'))!;
    await act(async () => flushBtn.click());
    expect(apiMocks.flushProactiveDigest).toHaveBeenCalledTimes(1);

    const rsiTabBtn = [...drawer.querySelectorAll('button')].find(b => b.textContent?.includes('已沉淀能力 (RSI)'))!;
    await act(async () => rsiTabBtn.click());
    expect(drawer.textContent).toContain('skill:contract-reply-standard v1');

    const rollbackBtn = [...drawer.querySelectorAll('button')].find(b => b.textContent?.includes('一键回滚'))!;
    await act(async () => rollbackBtn.click());
    expect(apiMocks.rollbackRsiCandidate).toHaveBeenCalledWith('rsi-skill-1');
  });
});
