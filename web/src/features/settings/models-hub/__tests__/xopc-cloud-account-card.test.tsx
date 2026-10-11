// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages } from '@/i18n/messages';
import { XopcCloudAccountCard } from '../xopc-cloud-account-card';

const state = vi.hoisted(() => {
  const value: { data: unknown; error: unknown } = { data: undefined, error: undefined };
  return value;
});
vi.mock('swr', () => ({ default: () => ({ ...state, isLoading: false, isValidating: false, mutate: vi.fn() }) }));

describe('Cloud Credit account', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let root: ReturnType<typeof createRoot>;
  afterEach(() => { act(() => root?.unmount()); state.data = undefined; state.error = undefined; });
  function render() {
    const element = document.createElement('div');
    root = createRoot(element);
    act(() => root.render(<XopcCloudAccountCard labels={messages('zh').capabilitiesSettings.xopcCloudAccount} />));
    return element;
  }
  it('renders microcredits as exact Credits and separates reservations from charged usage', () => {
    state.data = { schemaVersion: 2, creditUnit: { unit: 'credit', microPerCredit: '10000', version: 'credit-v1' },
      balance: { availableCreditMicro: '84320', purchasedCreditMicro: '84000', grantedCreditMicro: '320', usageReservedCreditMicro: '10000', refundReservedCreditMicro: '10000', expiring: [], updatedAt: '2026-10-11T00:00:00.000Z' },
      usage: { chargedCreditMicro: '1842', requests: 38, totalTokens: 126480 },
      links: { purchase: 'https://console.xopc.ai/models/credits/purchase', details: 'https://console.xopc.ai/models/billing' } };
    const element = render();
    expect(element.textContent).toContain('8.432');
    expect(element.textContent).toContain('0.1842 Credits');
    expect(element.textContent).toContain('预留中: 2 Credits');
    expect(element.querySelector('details')?.hasAttribute('open')).toBe(false);
    expect(element.textContent).not.toContain('84320');
  });
  it('shows an unavailable state instead of stale or fabricated zero balances', () => {
    state.error = new Error('OAuth scope denied');
    state.data = { balance: { availableCreditMicro: '0' } };
    const element = render();
    expect(element.textContent).toContain(messages('zh').capabilitiesSettings.xopcCloudAccount.unavailable);
    expect(element.textContent).not.toContain(messages('zh').capabilitiesSettings.xopcCloudAccount.zeroBalance);
  });
});
