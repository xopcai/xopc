import type { ChannelStatus } from '@/features/settings/channel-recipient-api';

import type { ChannelCatalogEntry, ChannelSetupStatus } from './use-channel-catalog';

export type ChannelRuntimeState =
  | 'needs_setup'
  | 'disabled'
  | 'checking'
  | 'running'
  | 'stopped';

function setupStatus(entry: ChannelCatalogEntry): ChannelSetupStatus {
  const ready = entry.configured === true;
  const enabled = entry.enabled === true;
  return entry.setupStatus ?? {
    enabled,
    ready,
    state: enabled && !ready ? 'needs_setup' : enabled ? 'ready' : 'disabled',
    issues: [],
  };
}

/**
 * Derive the user-facing lifecycle state from configuration readiness and the
 * gateway's current process status. A configured channel is not considered
 * running until the gateway reports it as connected.
 */
export function resolveChannelRuntime(
  entry: ChannelCatalogEntry,
  status: ChannelStatus | undefined,
  statusLoaded: boolean,
): ChannelRuntimeState {
  const setup = setupStatus(entry);
  if (!setup.ready) return 'needs_setup';
  if (!setup.enabled) return 'disabled';
  if (!statusLoaded) return 'checking';
  return status?.connected === true ? 'running' : 'stopped';
}
