// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/fetch', () => ({
  fetchJson: vi.fn(),
  apiFetch: vi.fn(),
}));

import { fetchJson } from '@/lib/fetch';
import {
  approveChannelPairingBySender,
  dismissChannelPairingPending,
  fetchChannelPairingState,
  fetchChannelPairingSummary,
} from '@/features/settings/channels-config-api';

describe('channels-config-api pairing', () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset();
  });

  it('fetchChannelPairingState loads pending state', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({
      ok: true,
      payload: {
        channel: 'telegram',
        accountId: 'default',
        dmPolicy: 'pairing',
        pending: [{ senderId: '123', codeLast4: 'ABCD' }],
        paired: { fromConfig: [], fromCredentials: [] },
      },
    });

    const state = await fetchChannelPairingState('telegram', 'default');
    expect(state.pending).toHaveLength(1);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining('/api/channels/pairing?channel=telegram&account=default'),
    );
  });

  it('fetchChannelPairingSummary loads hub counts', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({
      ok: true,
      payload: {
        summary: {
          telegram: { pending: 2, stale: 1, atCapacity: false },
          feishu: { pending: 0, stale: 0, atCapacity: false },
          weixin: { pending: 0, stale: 0, atCapacity: false },
        },
      },
    });

    const summary = await fetchChannelPairingSummary();
    expect(summary.telegram.pending).toBe(2);
    expect(summary.telegram.stale).toBe(1);
  });

  it('approveChannelPairingBySender posts sender id', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({
      ok: true,
      payload: { senderId: '916534770', alreadyPaired: false },
    });

    const result = await approveChannelPairingBySender({
      channel: 'telegram',
      accountId: 'default',
      senderId: '916534770',
    });
    expect(result.senderId).toBe('916534770');
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining('/api/channels/pairing/approve-sender'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('dismissChannelPairingPending deletes pending entry', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({
      ok: true,
      payload: { senderId: '111' },
    });

    const result = await dismissChannelPairingPending({
      channel: 'telegram',
      accountId: 'default',
      senderId: '111',
    });
    expect(result.senderId).toBe('111');
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining('/api/channels/pairing/pending'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
