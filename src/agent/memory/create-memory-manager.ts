import type { Config } from '../../config/schema.js';
import { resolveEffectiveAgentManifestForAgent } from '../../config/agent-profile.js';
import { resolveAgentIdForWorkspacePath } from '../agent-scope.js';
import { resolveMemoryAccessPolicy } from './access-policy.js';
import { BuiltinMemoryStore } from './builtin-memory-store.js';
import { BuiltinMemoryProvider } from './builtin-provider.js';
import { isMemorySubsystemEnabled } from './memory-config.js';
import { MemoryManager, type MemoryManagerOptions } from './manager.js';
import { loadMemoryPluginProviders } from './plugin-discovery.js';

export type MemoryProviderId = 'none' | 'stub';

export function createMemoryManagerFromConfig(
  workspaceDir: string,
  store: BuiltinMemoryStore,
  config: Config | undefined,
  agentId?: string,
): MemoryManager {
  const routing = resolveMemoryManagerOptions(workspaceDir, config, agentId);
  const accessPolicy = config && agentId ? resolveMemoryAccessPolicy(config, agentId) : undefined;
  const enabled = isMemorySubsystemEnabled(config);
  const mgr = new MemoryManager({
    ...routing,
    accessPolicy,
    ...(enabled ? { loadProviders: () => loadMemoryPluginProviders({ config }) } : {}),
  });
  mgr.addProvider(new BuiltinMemoryProvider(
    store,
    accessPolicy,
  ));

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
  const agentId = requestedAgentId?.trim() || resolveAgentIdForWorkspacePath(config, workspaceDir);
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
