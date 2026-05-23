import { describe, expect, it } from 'vitest';

import { emptyTelegramAccount } from '@/features/settings/channels-config-api';
import {
  channelUsesPairingPolicy,
  hubPairingPendingCount,
  resolveAccountDmPolicy,
  resolveAccountDmPolicyForConfig,
} from '@/features/settings/channels/pairing-policy';

describe('pairing-policy', () => {
  it('resolves account-level dmPolicy over channel default', () => {
    expect(resolveAccountDmPolicy('telegram', 'allowlist', { dmPolicy: 'pairing' })).toBe('pairing');
    expect(resolveAccountDmPolicy('weixin', 'open', { dmPolicy: 'pairing' })).toBe('pairing');
  });

  it('detects pairing when only an account overrides dmPolicy', () => {
    const tg = {
      enabled: true,
      dmPolicy: 'allowlist' as const,
      accounts: {
        default: { ...emptyTelegramAccount('default'), dmPolicy: 'allowlist' as const },
        bot2: { ...emptyTelegramAccount('bot2'), dmPolicy: 'pairing' as const },
      },
      apiRoot: '',
      debug: false,
      allowFrom: [],
      groupAllowFrom: [],
      groupPolicy: 'open' as const,
      replyToMode: 'off' as const,
      streamMode: 'partial' as const,
      historyLimit: 50,
      textChunkLimit: 4000,
      proxy: '',
    };
    expect(channelUsesPairingPolicy('telegram', tg)).toBe(true);
    expect(resolveAccountDmPolicyForConfig('telegram', tg, 'default')).toBe('allowlist');
    expect(resolveAccountDmPolicyForConfig('telegram', tg, 'bot2')).toBe('pairing');
  });

  it('hubPairingPendingCount requires configured, enabled, and pairing policy', () => {
    expect(
      hubPairingPendingCount({
        configured: false,
        channelEnabled: true,
        usesPairing: true,
        summaryPending: 3,
      }),
    ).toBe(0);
    expect(
      hubPairingPendingCount({
        configured: true,
        channelEnabled: false,
        usesPairing: true,
        summaryPending: 3,
      }),
    ).toBe(0);
    expect(
      hubPairingPendingCount({
        configured: true,
        channelEnabled: true,
        usesPairing: true,
        summaryPending: 3,
      }),
    ).toBe(3);
  });
});
