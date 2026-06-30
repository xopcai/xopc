import { describe, expect, it } from 'vitest';

import { BuiltinMemoryStore } from '../builtin-memory-store.js';
import { StubMemoryProvider } from '../stub-memory-provider.js';
import { MemoryManager } from '../manager.js';
import { BuiltinMemoryProvider } from '../builtin-provider.js';

describe('MemoryManager', () => {
  it('keeps local and multiple external providers for fanout routing', () => {
    const m = new MemoryManager();
    const store = new BuiltinMemoryStore({
      workspaceDir: '/tmp',
      memoriesDir: '/tmp/memories',
      memoryCharLimit: 100,
      userCharLimit: 100,
    });
    m.addProvider(new BuiltinMemoryProvider(store));
    m.addProvider(new StubMemoryProvider());
    m.addProvider(new StubMemoryProvider());
    const ids = m.providersList.map((p) => p.id);
    expect(ids).toEqual(['local', 'stub', 'stub']);
  });

  it('keeps the local provider writable', () => {
    const store = new BuiltinMemoryStore({
      workspaceDir: '/tmp',
      memoriesDir: '/tmp/memories',
      memoryCharLimit: 100,
      userCharLimit: 100,
    });
    const mgr = new MemoryManager();
    mgr.addProvider(new BuiltinMemoryProvider(store));
    const ids = mgr.providersList.map((p) => p.id);
    expect(ids).toContain('local');
    expect(mgr.providersList.find((p) => p.id === 'local')?.capabilities.write).toBe(true);
  });
});
