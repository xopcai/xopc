// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../user-context-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../user-context-api')>();
  return {
    ...actual,
    batchReviewContextObjects: vi.fn().mockResolvedValue({ objects: [] }),
    createUnderstanding: vi.fn(),
    fetchUnderstandingEvidence: vi.fn().mockResolvedValue({ evidence: [] }),
    updateUnderstanding: vi.fn().mockResolvedValue({ understanding: {} }),
    updateUserFocus: vi.fn().mockResolvedValue({ focus: {} }),
  };
});

import { batchReviewContextObjects, updateUnderstanding, type UserFocus, type UserUnderstanding } from '../user-context-api';
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
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('keeps current focus separate from a bounded review batch', async () => {
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
    expect(batchReviewContextObjects).toHaveBeenCalledWith([{
      objectType: 'focus', objectId: 'candidate', action: 'accept',
    }]);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('shows the whole network and keeps node actions in the selected detail', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const secondFocus: UserFocus = {
      ...activeFocus,
      id: 'second-map-focus',
      versionId: 'second-map-focus-v1',
      title: '完善发布自动化',
      summary: '继续改进发布流程',
      updatedAt: 1,
    };
    const unrelatedUnderstanding: UserUnderstanding = {
      ...preference,
      id: 'unrelated-understanding',
      versionId: 'unrelated-understanding-v1',
      kind: 'task_lesson',
      scope: { type: 'session', id: 'another-session' },
      statement: '数据库迁移必须使用事务',
    };
    await act(async () => root.render(<SharedUnderstandingPanel
      focuses={[activeFocus, secondFocus]}
      understandings={[preference, unrelatedUnderstanding]}
      language="zh"
      onRefresh={onRefresh}
    />));

    const mapTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent?.includes('关系'));
    await act(async () => mapTab?.click());
    expect(container.textContent).toContain('整体关系网');
    expect(container.textContent).toContain('发布 XOPC 1.0');
    expect(container.textContent).toContain('完善发布自动化');
    expect(container.textContent).toContain('数据库迁移必须使用事务');
    expect(container.textContent).not.toContain('图中关注');

    const contextNode = container.querySelector<HTMLElement>('[data-id="understanding:preference"]');
    await act(async () => contextNode?.click());

    expect(container.textContent).toContain('为什么展示这条关系');
    expect(container.textContent).toContain('主题信号');
    const incorrect = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '不正确');
    await act(async () => incorrect?.click());
    expect(updateUnderstanding).toHaveBeenCalledWith('preference', { status: 'rejected' });
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('keeps the portrait hero balanced when many active focuses exist', async () => {
    const focuses = [
      activeFocus,
      ...Array.from({ length: 5 }, (_, index) => ({
        ...activeFocus,
        id: `focus-${index}`,
        versionId: `focus-${index}-v1`,
        title: `进行中的关注 ${index + 1}`,
        updatedAt: 10 + index,
      })),
      { ...activeFocus, id: 'duplicate', versionId: 'duplicate-v1' },
    ];
    await act(async () => root.render(<SharedUnderstandingPanel
      focuses={focuses}
      understandings={[preference]}
      language="zh"
      onRefresh={vi.fn().mockResolvedValue(undefined)}
    />));

    expect(container.textContent).toContain('+1 项进行中的关注');
    expect(container.textContent).not.toContain('发布 XOPC 1.0');
    expect(container.textContent).toContain('持续构成画像的理解');
  });

  it('updates the portrait hero immediately when another focus is selected', async () => {
    const secondFocus: UserFocus = {
      ...activeFocus,
      id: 'second',
      versionId: 'second-v1',
      title: '完善连接器稳定性',
      summary: '处理连接器调用和检索故障',
      updatedAt: 1,
    };
    await act(async () => root.render(<SharedUnderstandingPanel
      focuses={[activeFocus, secondFocus]}
      understandings={[preference]}
      language="zh"
      onRefresh={vi.fn().mockResolvedValue(undefined)}
    />));

    expect(container.querySelector('h2')?.textContent).toBe('发布 XOPC 1.0');
    const focusButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('完善连接器稳定性'));
    await act(async () => focusButton?.click());

    expect(container.querySelector('h2')?.textContent).toBe('完善连接器稳定性');
    expect(container.querySelector('h2')?.nextElementSibling?.textContent).toBe('处理连接器调用和检索故障');
    expect(focusButton?.getAttribute('aria-pressed')).toBe('true');
  });

  it('reviews a bounded batch instead of presenting the whole backlog as progress', async () => {
    const candidates = Array.from({ length: 10 }, (_, index) => ({
      ...candidateFocus,
      id: `candidate-${index + 1}`,
      versionId: `candidate-${index + 1}-v1`,
      title: `候选关注 ${index + 1}`,
      summary: `候选摘要 ${index + 1}`,
      updatedAt: 10 + index,
    }));
    await act(async () => root.render(<SharedUnderstandingPanel
      focuses={[activeFocus, ...candidates]}
      understandings={[preference]}
      language="zh"
      onRefresh={vi.fn().mockResolvedValue(undefined)}
    />));

    const reviewTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent?.includes('待确认'));
    await act(async () => reviewTab?.click());
    expect(container.textContent).toContain('本批 8 组');
    expect(container.textContent).toContain('其余 2 项稍后处理');
    expect(container.textContent).toContain('候选关注 10');
    expect(container.textContent).not.toContain('候选关注 1候选摘要 1');

    const nextBatch = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '换一批');
    await act(async () => nextBatch?.click());
    expect(container.textContent).toContain('候选关注 1');
  });

  it('keeps candidates out of the timeline and reveals older changes on demand', async () => {
    const activeUnderstandings = Array.from({ length: 14 }, (_, index) => ({
      ...preference,
      id: `understanding-${index + 1}`,
      versionId: `understanding-${index + 1}-v1`,
      statement: `已确认理解 ${index + 1}`,
      updatedAt: 100 + index,
    }));
    const candidateUnderstanding: UserUnderstanding = {
      ...preference,
      id: 'understanding-candidate',
      versionId: 'understanding-candidate-v1',
      status: 'candidate',
      statement: '尚未进入画像的候选',
      updatedAt: 1_000,
    };
    await act(async () => root.render(<SharedUnderstandingPanel
      focuses={[activeFocus]}
      understandings={[...activeUnderstandings, candidateUnderstanding]}
      language="zh"
      onRefresh={vi.fn().mockResolvedValue(undefined)}
    />));

    const changesTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent?.includes('最近变化'));
    await act(async () => changesTab?.click());
    expect(container.textContent).toContain('当前展示最近 12 条变化');
    expect(container.textContent).not.toContain('尚未进入画像的候选');
    expect([...container.querySelectorAll('p')].some((element) => element.textContent === '已确认理解 1')).toBe(false);

    const showMore = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '继续展开');
    await act(async () => showMore?.click());
    expect([...container.querySelectorAll('p')].some((element) => element.textContent === '已确认理解 1')).toBe(true);
  });
});
