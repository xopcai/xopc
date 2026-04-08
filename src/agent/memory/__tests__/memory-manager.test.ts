import { describe, expect, it } from 'vitest';

import type { Config } from '../../../config/schema.js';
import { BuiltinMemoryStore } from '../builtin-memory-store.js';
import { createMemoryManagerFromConfig } from '../create-memory-manager.js';
import { StubMemoryProvider } from '../stub-memory-provider.js';
import { MemoryManager } from '../manager.js';
import { BuiltinMemoryProvider } from '../builtin-provider.js';

describe('MemoryManager', () => {
  it('rejects a second external provider', () => {
    const m = new MemoryManager();
    const store = new BuiltinMemoryStore({
      workspaceDir: '/tmp',
      memoryCharLimit: 100,
      userCharLimit: 100,
    });
    m.addProvider(new BuiltinMemoryProvider(store));
    m.addProvider(new StubMemoryProvider());
    m.addProvider(new StubMemoryProvider());
    const externals = m.providersList.filter((p) => p.name !== 'builtin');
    expect(externals).toHaveLength(1);
  });

  it('createMemoryManagerFromConfig adds stub when configured', () => {
    const store = new BuiltinMemoryStore({
      workspaceDir: '/tmp',
      memoryCharLimit: 100,
      userCharLimit: 100,
    });
    const mgr = createMemoryManagerFromConfig('/tmp', store, {
      agents: { defaults: { memory: { provider: 'stub' } } },
    } as Config);
    const names = mgr.providersList.map((p) => p.name);
    expect(names).toContain('builtin');
    expect(names).toContain('stub');
  });
});
