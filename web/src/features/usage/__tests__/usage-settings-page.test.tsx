// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UsageSettingsPage } from '../usage-settings-page';

const data = vi.hoisted((): { summary: unknown; events: unknown } => ({ summary: undefined, events: undefined }));
vi.mock('swr', () => ({ default: (key: string[]) => ({ data: key[0] === 'usage-summary' ? data.summary : data.events, mutate: vi.fn() }) }));
vi.mock('@/stores/locale-store', () => ({ useLocaleStore: (selector: (state: { language: string }) => unknown) => selector({ language: 'zh' }) }));
vi.mock('@/features/settings/models-hub/xopc-cloud-account-card', () => ({ XopcCloudAccountCard: () => <div>Cloud wallet</div> }));
vi.mock('@/features/settings/settings-page-layout', () => ({ SettingsPageFrame: ({ children }: { children: unknown }) => <div>{children as never}</div>, SettingsPageHeader: () => <div /> }));

describe('Usage billing presentation', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let root: ReturnType<typeof createRoot>;
  afterEach(() => { act(() => root?.unmount()); });
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
    act(() => root.render(<UsageSettingsPage />));
    expect(element.textContent).toContain('≥ 2.35 Credits');
    expect(element.textContent).toContain('≈ $0.02');
    expect(element.textContent).toContain('结算中 · 已预留 5 Credits');
    expect(element.textContent).toContain('本地运行，不扣 Cloud Credits');
    expect(element.textContent).not.toContain('$2.35');
    expect(element.textContent).not.toContain('23500 Credits');
  });
});
