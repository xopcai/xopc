import { describe, expect, it } from 'vitest';

import { channelDetailPath, isManageableChannelId, normalizeChannelRouteId } from '@/features/settings/channels/channels-routes';

describe('channels-routes', () => {
  it('normalizes route channel ids', () => {
    expect(normalizeChannelRouteId(' Telegram ')).toBe('telegram');
    expect(normalizeChannelRouteId(undefined)).toBeNull();
  });

  it('builds detail paths with optional pairing query', () => {
    expect(channelDetailPath('telegram')).toBe('/channels/telegram');
    expect(channelDetailPath('telegram', { pairing: true })).toBe('/channels/telegram?pairing=1');
  });

  it('detects manageable built-in channels', () => {
    expect(isManageableChannelId('telegram')).toBe(true);
    expect(isManageableChannelId('matrix')).toBe(false);
  });
});
