import { createHash } from 'node:crypto';
import type { EndpointContext } from '@xopcai/gateway-contract';
import type { EndpointContextView, LocationShareSummary } from '@xopcai/endpoint-tools-protocol';

import { getEndpointDeviceSettings } from '../storage/sqlite/endpoint-device-settings-repository.js';
import type { AgentSourceContext } from '../agent/source-context/types.js';
import type { GatewayPrincipal } from '../gateway/security/gateway-principal.js';
import type { EndpointConnectionSnapshot, EndpointRegistry } from './registry.js';

export function endpointClaimBelongsToPrincipal(registry: EndpointRegistry, endpointId: string, principal: GatewayPrincipal): boolean {
  const endpoint = registry.get(endpointId);
  return Boolean(endpoint && (principal.kind === 'owner'
    || principal.kind === 'device' && endpoint.principalId === principal.deviceId));
}

export function deviceTurnSourceContext(endpoint: EndpointConnectionSnapshot, environment?: EndpointContext, taskContext?: EndpointContextView, locationShares?: LocationShareSummary[]): AgentSourceContext {
  const name = getEndpointDeviceSettings(endpoint.principalId)?.nickname ?? endpoint.displayName;
  const snapshot = {
    endpointId: endpoint.endpointId, principalId: endpoint.principalId,
    name: name.slice(0, 80), platform: endpoint.platform.slice(0, 40), kind: endpoint.kind,
    ...(environment ? { environment } : {}),
    ...(taskContext ? { taskContext } : {}),
    ...(locationShares?.length ? { locationShares: locationShares.slice(-3) } : {}),
  };
  const text = JSON.stringify(snapshot).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
  return {
    kind: 'device_context', sourceId: endpoint.endpointId,
    version: createHash('sha256').update(text).digest('hex'),
    title: name.slice(0, 80), text,
    capturedAt: environment?.capturedAt ?? Date.now(),
  };
}
