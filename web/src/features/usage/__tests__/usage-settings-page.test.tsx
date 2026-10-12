// @vitest-environment jsdom
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UsageSettingsPage } from '../usage-settings-page';

const data = vi.hoisted((): { summary: unknown; events: unknown; keys: unknown[][]; eventsError?: Error } => ({ summary: undefined, events: undefined, keys: [] }));
vi.mock('swr', () => ({ default: (key: unknown[]) => { data.keys.push(key); return { data: key[0] === 'usage-summary' ? data.summary : data.events, error: key[0] === 'usage-events' ? data.eventsError : undefined, mutate: vi.fn() }; } }));
vi.mock('@/stores/locale-store', () => ({ useLocaleStore: (selector: (state: { language: string }) => unknown) => selector({ language: 'zh' }) }));
vi.mock('@/features/settings/models-hub/xopc-cloud-account-card', () => ({ XopcCloudAccountCard: () => <div>Cloud wallet</div> }));
vi.mock('@/features/settings/settings-page-layout', () => ({ SettingsPageFrame: ({ children }: { children: unknown }) => <div>{children as never}</div>, SettingsPageHeader: ({ actions }: { actions: unknown }) => <div>{actions as never}</div> }));

describe('Usage billing presentation', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let root: ReturnType<typeof createRoot>;
  afterEach(() => { act(() => root?.unmount()); data.keys = []; data.eventsError = undefined; });
  it('keeps confirmed Credits, external USD estimates, pending reservations and local calls separate', () => {
    const totals = { calls: 4, totalTokens: 100, knownCostUsd: '0.02', unknownCostCalls: 0, costCompleteness: 'complete',
      billing: { external: { calls: 1, estimatedCostUsd: '0.02', unknownCostCalls: 0 }, localCalls: 1,
        cloud: { calls: 2, settledCalls: 1, pendingCalls: 1, unavailableCalls: 0, chargedCreditMicro: '23500', reservedCreditMicro: '50000' } } };
    data.summary = { totals, byCategory: [{ key: 'chat', totals }], byModel: [] };
    const common = { traceId: 'mixed-task', provider: 'xopc-cloud', model: 'same-model', status: 'succeeded', startedAt: 1, reasonKey: 'usage.reason.agentAnswer', totalTokens: 25 };
    data.events = { items: [
      { ...common, id: 'charged', billing: { source: 'xopc_cloud', state: 'settled', chargedCreditMicro: '23500' } },
      { ...common, id: 'pending', billing: { source: 'xopc_cloud', state: 'pending', chargedCreditMicro: null, reservedCreditMicro: '50000' } },
      { ...common, id: 'byok', provider: 'openai', estimatedCostUsd: '0.02', billing: { source: 'external_provider', currency: 'USD' } },
      { ...common, id: 'local', provider: 'ollama', billing: { source: 'local' } },
    ] };
    const element = document.createElement('div'); root = createRoot(element);
    act(() => root.render(<MemoryRouter><UsageSettingsPage /></MemoryRouter>));
    expect(element.textContent).toContain('≥ 2.35 Credits');
    expect(element.textContent).toContain('≈ $0.02');
    expect(element.textContent).toContain('结算中 · 已预留 5 Credits');
    expect(element.textContent).toContain('本地运行，不扣 Cloud Credits');
    expect(element.textContent).not.toContain('$2.35');
    expect(element.textContent).not.toContain('23500 Credits');
  });
  const setup = (initialEntry = '/settings/usage') => {
    const totals = { calls: 42, totalTokens: 1200, billing: { external: { calls: 42, estimatedCostUsd: '0.02', unknownCostCalls: 0 }, localCalls: 0, cloud: { calls: 0 } } };
    data.summary = { totals, byCategory: Array.from({ length: 8 }, (_, i) => ({ key: `scenario-${i}`, totals })), byModel: [] };
    data.events = { items: [{ id: 'first', provider: 'openai', model: 'first-model', startedAt: 1, status: 'succeeded' }], nextCursor: '1:first' };
    const element = document.createElement('div'); root = createRoot(element);
    act(() => root.render(<MemoryRouter initialEntries={[initialEntry]}><UsageSettingsPage /></MemoryRouter>));
    return element;
  };
  const click = (element: HTMLElement, text: string) => {
    const button = Array.from(element.querySelectorAll<HTMLButtonElement>('nav[aria-label="调用明细分页"] button')).find(item => item.textContent === text);
    expect(button).toBeDefined();
    act(() => button!.click());
  };
  it('uses server cursors, preserves the time window and restores previous pages', () => {
    const element = setup();
    const firstQuery = data.keys.find(key => key[0] === 'usage-events')![1];
    click(element, '下一页');
    expect(data.keys.at(-1)).toEqual(['usage-events', firstQuery, '1:first', 20]);
    expect(element.textContent).toContain('第 2 页');
    click(element, '上一页');
    expect(data.keys.at(-1)).toEqual(['usage-events', firstQuery, undefined, 20]);
    expect(element.textContent).toContain('第 1 页');
  });
  it('restores deep links and keeps overview visible when the detail request fails', () => {
    const element = setup('/settings/usage?days=30&size=50&to=1791797274639&cursor=2:older');
    expect(data.keys.at(-1)).toEqual(['usage-events', expect.stringContaining('to=1791797274639'), '2:older', 50]);
    data.events = undefined;
    data.eventsError = new Error('offline');
    act(() => root.render(<MemoryRouter initialEntries={['/settings/usage?days=30&size=50&to=1791797274639&cursor=2:older']}><UsageSettingsPage /></MemoryRouter>));
    expect(element.textContent).toContain('用量摘要');
    expect(element.textContent).toContain('无法加载用量数据');
    click(element, '返回首页');
    expect(data.keys.at(-1)?.[2]).toBeUndefined();
  });
  it('bounds distribution rows and disables next on the last history page', () => {
    const element = setup();
    expect(element.textContent).toContain('scenario-5');
    expect(element.textContent).not.toContain('scenario-6');
    act(() => element.querySelector<HTMLButtonElement>('[aria-label="下一页用量分布"]')!.click());
    expect(element.textContent).toContain('scenario-6');
    expect(element.textContent).not.toContain('scenario-0');
    data.events = { items: [] };
    act(() => root.render(<MemoryRouter><UsageSettingsPage /></MemoryRouter>));
    const next = Array.from(element.querySelectorAll<HTMLButtonElement>('nav[aria-label="调用明细分页"] button')).find(item => item.textContent === '下一页');
    expect(next?.disabled).toBe(true);
  });

  it('refreshes the snapshot and returns both lists to their first page', () => {
    const element = setup('/settings/usage?to=1791797274639&cursor=2:older&groupPage=2');
    act(() => element.querySelector<HTMLButtonElement>('[aria-label="刷新用量"]')!.click());
    expect(data.keys.at(-1)?.[2]).toBeUndefined();
    expect(data.keys.at(-1)?.[1]).not.toContain('to=1791797274639');
    expect(element.textContent).toContain('第 1 / 2 页');
  });

});
