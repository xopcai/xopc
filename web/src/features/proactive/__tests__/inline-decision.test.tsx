// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProactiveCard } from '@xopcai/gateway-contract';
import { ProactiveCardView } from '../proactive-card';
import { proactiveCopy } from '../copy';
import { proactiveWrite } from '../api';
vi.mock('../api', () => ({ proactiveWrite: vi.fn() }));
vi.mock('@/components/markdown/markdown-view', () => ({ MarkdownView: () => null }));

describe('inline proactive decisions', () => {
  let root: ReturnType<typeof createRoot>;
  let element: HTMLDivElement;
  beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks(); element = document.createElement('div'); document.body.append(element); root = createRoot(element); });
  afterEach(() => { act(() => root.unmount()); element.remove(); });
  const card = { id: 'card', revision: 1, status: 'unread', title: 'Choose next step', updatedAt: '2026-09-15T00:00:00Z', kind: 'recommendation', evidence: [], decision: { question: 'Create task?', options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Reject' }] } } as unknown as ProactiveCard;
  async function render(value: ProactiveCard) { await act(async () => { root.render(<MemoryRouter><ProactiveCardView card={value} copy={proactiveCopy(true)} refresh={vi.fn()} /></MemoryRouter>); }); }
  it('shows decisions in list cards and blocks stale drafts until explicitly reloaded', async () => {
    await render(card);
    const approve = () => Array.from(element.querySelectorAll('button')).find(button => button.textContent === 'Approve')!;
    expect(approve().disabled).toBe(false);
    await render({ ...card, revision: 2 });
    expect(approve().disabled).toBe(true);
    act(() => Array.from(element.querySelectorAll('button')).find(button => button.textContent === '载入最新版本')!.click());
    expect(approve().disabled).toBe(false);
    vi.mocked(proactiveWrite).mockResolvedValue({ card: { ...card, revision: 3, decision: undefined } });
    await act(async () => { approve().click(); });
    expect(proactiveWrite).toHaveBeenCalledWith('/api/inbox/judgments/card/actions', 'POST', expect.objectContaining({ actionId: 'decide', choice: 'approve', expectedRevision: 2 }));
    expect(element.querySelector('[role="status"]')?.textContent).toContain('决定已提交');
    await render({ ...card, id: 'next-card', revision: 2 });
    expect(element.querySelector('[role="status"]')).toBeNull();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('卡片已更新');
  });
});
