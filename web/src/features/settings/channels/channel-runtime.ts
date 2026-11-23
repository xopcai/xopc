import type { ChannelStatus } from '@/features/settings/channel-recipient-api';

import type { ChannelCatalogEntry, ChannelSetupStatus } from './use-channel-catalog';

export type ChannelRuntimeState =
  | 'needs_setup'
  | 'disabled'
  | 'checking'
  | 'running'
  | 'reconnect_required'
  | NonNullable<ChannelStatus['connectionIssue']>
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
  if (status?.connected === true) return 'running';
  if (status?.reconnectRequired === true) return 'reconnect_required';
  if (status?.connectionIssue) return status.connectionIssue;
  if (status?.connecting === true) return 'checking';
  return 'stopped';
}
