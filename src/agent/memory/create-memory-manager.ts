import type { Config } from '../../config/schema.js';
import { BuiltinMemoryStore } from './builtin-memory-store.js';
import { BuiltinMemoryProvider } from './builtin-provider.js';
import { isMemorySubsystemEnabled } from './memory-config.js';
import { MemoryManager, type MemoryManagerOptions } from './manager.js';
import type { MemoryKind } from './types.js';
import { loadMemoryPluginProviders } from './plugin-discovery.js';

export type MemoryProviderId = 'none' | 'stub';

export function createMemoryManagerFromConfig(
  workspaceDir: string,
  store: BuiltinMemoryStore,
  config: Config | undefined,
  agentId?: string,
): MemoryManager {
  const routing = resolveMemoryManagerOptions(workspaceDir, config, agentId);
  const enabled = isMemorySubsystemEnabled(config);
  const mgr = new MemoryManager({
    ...routing,
    ...(enabled ? { loadProviders: () => loadMemoryPluginProviders({ config }) } : {}),
  });
  mgr.addProvider(new BuiltinMemoryProvider(store));

  if (!enabled) {
    return mgr;
  }

  return mgr;
}

function resolveMemoryManagerOptions(
  workspaceDir: string,
  config: Config | undefined,
  requestedAgentId?: string,
): Omit<MemoryManagerOptions, 'loadProviders'> {
  if (!config) return {};
  void workspaceDir;
  void requestedAgentId;
  const providerRouting = config.userContext.providerRouting;
  return {
    searchStrategy: providerRouting.searchStrategy,
    writeStrategy: providerRouting.writeStrategy,
    writePolicy: {
      allowExternalWrites: providerRouting.allowExternalWrites,
      allowedProviderIds: providerRouting.allowedProviderIds,
      autoWriteKinds: providerRouting.autoWriteKinds as MemoryKind[] | undefined,
    },
  };
}
