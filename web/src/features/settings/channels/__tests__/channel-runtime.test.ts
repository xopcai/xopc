import { describe, expect, it } from 'vitest';

import { resolveChannelRuntime } from '@/features/settings/channels/channel-runtime';
import type { ChannelCatalogEntry } from '@/features/settings/channels/use-channel-catalog';

const readyEntry: ChannelCatalogEntry = {
  id: 'telegram',
  extensionId: 'telegram',
  source: 'bundled',
  label: 'Telegram',
  order: 1,
  configPath: 'channels.telegram',
  enabled: true,
  configured: true,
};

describe('resolveChannelRuntime', () => {
  it('does not mistake configuration for a running connection', () => {
    expect(resolveChannelRuntime(readyEntry, { name: 'telegram', enabled: true, connected: false }, true)).toBe('stopped');
  });

  it('uses the gateway connection signal once it is available', () => {
    expect(resolveChannelRuntime(readyEntry, { name: 'telegram', enabled: true, connected: true }, true)).toBe('running');
  });

  it('treats a missing gateway status as stopped after status loading completes', () => {
    expect(resolveChannelRuntime(readyEntry, undefined, true)).toBe('stopped');
  });

  it('keeps setup and disabled states ahead of runtime', () => {
    expect(resolveChannelRuntime({ ...readyEntry, configured: false }, undefined, true)).toBe('needs_setup');
    expect(resolveChannelRuntime({ ...readyEntry, enabled: false }, undefined, true)).toBe('disabled');
  });

  it('waits for gateway status instead of inferring a connection from catalog metadata', () => {
    expect(resolveChannelRuntime({ ...readyEntry, runtime: 'loaded' }, undefined, false)).toBe('checking');
    expect(resolveChannelRuntime(readyEntry, undefined, false)).toBe('checking');
  });
});
