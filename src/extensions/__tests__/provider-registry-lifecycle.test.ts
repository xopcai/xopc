import { describe, expect, it } from 'vitest';

import { ProviderPluginRegistry } from '../../providers/plugin-registry.js';
import type { ProviderPlugin } from '../types/providers.js';

function provider(id: string, name: string): ProviderPlugin {
  return {
    id,
    name,
    models: [],
    async *createStream() {
      yield { type: 'done' } as const;
    },
  };
}

describe('ProviderPluginRegistry lifecycle', () => {
  it('restores an overridden provider when the newer registration unloads', () => {
    const registry = new ProviderPluginRegistry();
    const bundled = provider('shared', 'Bundled');
    const extension = provider('shared', 'Extension');
    registry.register(bundled);
    const cleanup = registry.register(extension);

    expect(registry.get('shared')).toBe(extension);
    cleanup();
    expect(registry.get('shared')).toBe(bundled);
  });

  it('does not remove a registration that was replaced again', () => {
    const registry = new ProviderPluginRegistry();
    const first = provider('shared', 'First');
    const second = provider('shared', 'Second');
    const third = provider('shared', 'Third');
    registry.register(first);
    const cleanupSecond = registry.register(second);
    registry.register(third);

    cleanupSecond();
    expect(registry.get('shared')).toBe(third);
  });
});
