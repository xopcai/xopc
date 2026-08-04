import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelPlugin } from '../plugin-types.js';
import { ChannelPluginRegistry } from '../plugin-registry.js';
import { syncChannelPluginsFromManager } from '../plugins/registry.js';

vi.mock('../plugins/registry.js', () => ({
  syncChannelPluginsFromManager: vi.fn(),
}));

function plugin(id: string): ChannelPlugin {
  return { id } as ChannelPlugin;
}

describe('ChannelPluginRegistry', () => {
  beforeEach(() => {
    vi.mocked(syncChannelPluginsFromManager).mockClear();
  });

  it('treats registering the same plugin instance as idempotent', () => {
    const registry = new ChannelPluginRegistry();
    const instance = plugin('weixin');

    registry.register(instance);
    registry.register(instance);

    expect(registry.get('weixin')).toBe(instance);
    expect(syncChannelPluginsFromManager).toHaveBeenCalledTimes(1);
  });

  it('still replaces a different plugin instance with the same id', () => {
    const registry = new ChannelPluginRegistry();
    const first = plugin('weixin');
    const replacement = plugin('weixin');

    registry.register(first);
    registry.register(replacement);

    expect(registry.get('weixin')).toBe(replacement);
    expect(syncChannelPluginsFromManager).toHaveBeenCalledTimes(2);
  });
});
