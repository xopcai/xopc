import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';

import type { DeviceGrantService } from './grant-service.js';
import { deviceCapabilityTarget } from './capability-catalog.js';
import type { EndpointTaskTargetService } from './task-targets.js';
import type { EndpointRegistry } from './registry.js';
import type { GatewayPrincipal } from '../gateway/security/gateway-principal.js';

export class DeviceTargetResolver {
  private readonly snapshots = new Map<string, { target: ReturnType<EndpointTaskTargetService['get']>; resolved: ReturnType<EndpointTaskTargetService['resolve']> }>();
  private snapshot(conversationId: string) {
    if (!this.cacheSnapshot || !this.snapshots.has(conversationId)) this.snapshots.set(conversationId, {
      target: this.targets.get(conversationId), resolved: this.targets.resolve(conversationId),
    });
    return this.snapshots.get(conversationId)!;
  }
  constructor(private readonly registry: EndpointRegistry, private readonly targets: EndpointTaskTargetService,
    private readonly grants?: DeviceGrantService, private readonly actor?: GatewayPrincipal, private readonly cacheSnapshot = false) {}

  candidates(conversationId: string, origin: TurnOrigin) {
    const source = origin.type === 'endpoint' ? this.registry.get(origin.endpointId) : undefined;
    const binding = this.snapshot(conversationId).target;
    const execution = binding ? this.snapshot(conversationId).resolved : source;
    const authorized = (this.grants?.candidates(conversationId, origin) ?? []).map(grant => this.registry.get(grant.targetEndpointId));
    const discoverable = this.actor && this.actor.kind !== 'device' && this.actor.scopes.includes('gateway.admin') ? this.registry.list() : [];
    return [...new Map([source, execution, ...authorized, ...discoverable].filter(endpoint => endpoint !== undefined)
      .map(endpoint => [endpoint.endpointId, endpoint])).values()];
  }

  resolve(conversationId: string, origin: TurnOrigin, endpointId: string, toolName: string) {
    const grant = this.grants?.find(conversationId, origin, endpointId, toolName);
    if (grant) return this.registry.get(grant.targetEndpointId);
    const binding = this.snapshot(conversationId).target;
    if (deviceCapabilityTarget(toolName) !== 'turn_origin' && binding) {
      const selected = binding.endpointId === endpointId ? this.snapshot(conversationId).resolved : undefined;
      if (this.actor && this.actor.kind !== 'device' && this.actor.scopes.includes('gateway.admin')) return selected;
      const source = origin.type === 'endpoint' ? this.registry.get(origin.endpointId) : undefined;
      return selected && selected.principalId === source?.principalId
        && (!this.actor || this.actor.deviceId === selected.principalId) ? selected : undefined;
    }
    if (deviceCapabilityTarget(toolName) !== 'turn_origin' && this.actor && this.actor.kind !== 'device' && this.actor.scopes.includes('gateway.admin')) {
      return this.registry.get(endpointId);
    }
    const targetId = deviceCapabilityTarget(toolName) === 'turn_origin'
      ? origin.type === 'endpoint' ? origin.endpointId : undefined
      : binding?.endpointId ?? (origin.type === 'endpoint' ? origin.endpointId : undefined);
    return targetId === endpointId ? this.registry.get(endpointId) : undefined;
  }
}
