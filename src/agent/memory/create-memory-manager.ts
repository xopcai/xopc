import type { Config } from '../../config/schema.js';
import { resolveEffectiveAgentManifestForAgent } from '../../config/agent-profile.js';
import { resolveAgentIdForWorkspacePath } from '../agent-scope.js';
import { BuiltinMemoryStore } from './builtin-memory-store.js';
import { BuiltinMemoryProvider } from './builtin-provider.js';
import { isMemorySubsystemEnabled } from './memory-config.js';
import { MemoryManager, type MemoryManagerOptions } from './manager.js';
import { loadMemoryPluginProviders } from './plugin-discovery.js';

export type MemoryProviderId = 'none' | 'stub';

export function createMemoryManagerFromConfig(
  _workspaceDir: string,
  store: BuiltinMemoryStore,
  config: Config | undefined,
): MemoryManager {
  const routing = resolveMemoryManagerOptions(_workspaceDir, config);
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
): Omit<MemoryManagerOptions, 'loadProviders'> {
  if (!config) return {};
  const agentId = resolveAgentIdForWorkspacePath(config, workspaceDir);
  const manifest = resolveEffectiveAgentManifestForAgent(config, agentId);
  const providerRouting = manifest.memory.providerRouting;
  if (!providerRouting) return {};
  return {
    searchStrategy: providerRouting.searchStrategy,
    writeStrategy: providerRouting.writeStrategy,
    writePolicy: {
      allowExternalWrites: providerRouting.allowExternalWrites,
      allowedProviderIds: providerRouting.allowedProviderIds,
      autoWriteKinds: providerRouting.autoWriteKinds,
    },
  };
}
