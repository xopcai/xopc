import type { Config } from '../../config/schema.js';
import { BuiltinMemoryProvider } from './builtin-provider.js';
import { isMemorySubsystemEnabled } from './memory-config.js';
import { MemoryManager, type MemoryManagerOptions } from './manager.js';
import type { MemoryKind } from './types.js';
import { loadMemoryPluginProviders } from './plugin-discovery.js';

export type MemoryProviderId = 'none' | 'stub';

export function createMemoryManagerFromConfig(
  config: Config | undefined,
): MemoryManager {
  const routing = resolveMemoryManagerOptions(config);
  const enabled = isMemorySubsystemEnabled(config);
  const mgr = new MemoryManager({
    ...routing,
    ...(enabled ? { loadProviders: () => loadMemoryPluginProviders({ config }) } : {}),
  });
  mgr.addProvider(new BuiltinMemoryProvider());

  if (!enabled) {
    return mgr;
  }

  return mgr;
}

function resolveMemoryManagerOptions(
  config: Config | undefined,
): Omit<MemoryManagerOptions, 'loadProviders'> {
  if (!config) return {};
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
