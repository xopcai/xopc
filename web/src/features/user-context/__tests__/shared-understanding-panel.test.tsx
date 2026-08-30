// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../user-context-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../user-context-api')>();
  return {
    ...actual,
    createUnderstanding: vi.fn(),
    fetchUnderstandingEvidence: vi.fn().mockResolvedValue({ evidence: [] }),
    updateUnderstanding: vi.fn().mockResolvedValue({ understanding: {} }),
    updateUserFocus: vi.fn().mockResolvedValue({ focus: {} }),
  };
});

import { updateUnderstanding, updateUserFocus, type UserFocus, type UserUnderstanding } from '../user-context-api';
import { SharedUnderstandingPanel } from '../shared-understanding-panel';

const activeFocus: UserFocus = {
  id: 'active', versionId: 'active-v1', principalId: 'local-owner', title: '发布 XOPC 1.0', summary: '完成发布前验证', horizon: 'current', status: 'active',
  confidence: 1, scope: { type: 'global' }, explicitness: 'explicit', sensitivity: 'normal',
  disclosurePolicy: 'referenceable', evidenceRefs: [], createdAt: 1, updatedAt: 2,
};
const candidateFocus: UserFocus = {
  id: 'candidate', versionId: 'candidate-v1', principalId: 'local-owner', title: '研究长期记忆图谱', summary: '这是候选关注', horizon: 'ongoing', status: 'candidate',
  confidence: 0.8, scope: { type: 'global' }, explicitness: 'inferred', sensitivity: 'normal',
  disclosurePolicy: 'referenceable', evidenceRefs: [], createdAt: 2, updatedAt: 3,
};
const preference: UserUnderstanding = {
  id: 'preference', kind: 'preference', status: 'active', scope: { type: 'global' }, explicitness: 'explicit',
  durability: 'durable', sensitivity: 'normal', disclosurePolicy: 'referenceable', confidence: 1,
  statement: '发布前先完成验证', versionId: 'v1', createdAt: 1, updatedAt: 2,
};

describe('SharedUnderstandingPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('keeps current focus separate from the one-at-a-time review queue', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<SharedUnderstandingPanel
      focuses={[activeFocus, candidateFocus]}
      understandings={[preference]}
      language="zh"
      onRefresh={onRefresh}
    />));

    expect(container.textContent).toContain('发布 XOPC 1.0');
    expect(container.textContent).not.toContain('这是候选关注');

    const reviewTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent?.includes('待确认'));
    await act(async () => reviewTab?.click());
    expect(container.textContent).toContain('这是候选关注');
    expect(container.querySelectorAll('button').length).toBeLessThan(10);

    const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '是的');
    await act(async () => confirm?.click());
    expect(updateUserFocus).toHaveBeenCalledWith('candidate', { status: 'active' });
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('shows only related nodes and keeps their actions in the selected detail', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<SharedUnderstandingPanel
      focuses={[activeFocus]}
      understandings={[preference]}
      language="zh"
      onRefresh={onRefresh}
    />));

    const mapTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent?.includes('关系'));
    await act(async () => mapTab?.click());
    expect([...container.querySelectorAll<HTMLButtonElement>('button')]
      .some((button) => button.textContent === '编辑')).toBe(true);

    const contextNode = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('发布前先完成验证'));
    await act(async () => contextNode?.click());

    expect(container.textContent).toContain('为什么展示这条关系');
    expect(container.textContent).toContain('主题信号');
    const incorrect = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '不正确');
    await act(async () => incorrect?.click());
    expect(updateUnderstanding).toHaveBeenCalledWith('preference', { status: 'rejected' });
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
