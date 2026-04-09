import type { Config } from '../../config/schema.js';
import { BuiltinMemoryStore } from './builtin-memory-store.js';
import { BuiltinMemoryProvider } from './builtin-provider.js';
import { isMemorySubsystemEnabled } from './memory-config.js';
import { MemoryManager } from './manager.js';
import { StubMemoryProvider } from './stub-memory-provider.js';

export type MemoryProviderId = 'none' | 'stub';

export function createMemoryManagerFromConfig(
  _workspaceDir: string,
  store: BuiltinMemoryStore,
  config: Config | undefined,
): MemoryManager {
  const mgr = new MemoryManager();
  mgr.addProvider(new BuiltinMemoryProvider(store));

  if (!isMemorySubsystemEnabled(config)) {
    return mgr;
  }

  const id = (config?.agents?.defaults?.memory?.provider ?? 'none') as MemoryProviderId;
  if (id === 'stub') {
    const stub = new StubMemoryProvider();
    if (stub.isAvailable()) {
      mgr.addProvider(stub);
    }
  }

  return mgr;
}
