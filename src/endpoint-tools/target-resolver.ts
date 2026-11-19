import { isDeviceFolderTool, type TurnOrigin } from '@xopcai/endpoint-tools-protocol';

import { deviceFoldersFor } from './folder-connections.js';
import { deviceCapabilityAllowed, isManagedDeviceCapability } from './device-capability-grants.js';

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
    if (binding?.capabilityTool) return execution ? [execution] : [];
    const authorized = (this.grants?.candidates(conversationId, origin) ?? []).map(grant => this.registry.get(grant.targetEndpointId));
    const discoverable = this.actor && this.actor.kind !== 'device' && this.actor.scopes.includes('gateway.admin') ? this.registry.list() : [];
    return [...new Map([source, execution, ...authorized, ...discoverable].filter(endpoint => endpoint !== undefined)
      .map(endpoint => [endpoint.endpointId, endpoint])).values()];
  }

  resolve(conversationId: string, origin: TurnOrigin, endpointId: string, toolName: string) {
    const binding = this.snapshot(conversationId).target;
    const requested = this.registry.get(endpointId);
    const originEndpoint = origin.type === 'endpoint' ? this.registry.get(origin.endpointId) : undefined;
    const grant = binding?.capabilityTool ? undefined : this.grants?.find(conversationId, origin, endpointId, toolName);
    if (requested && isManagedDeviceCapability(requested, toolName)
      && (binding?.capabilityTool || originEndpoint?.principalId !== requested.principalId)
      && !(requested.kind === 'mobile' && grant)
      && !deviceCapabilityAllowed(requested, toolName)) return undefined;
    if (binding?.capabilityTool) {
      const endpoint = this.snapshot(conversationId).resolved;
      const tool = this.registry.getTool(endpointId, toolName);
      return this.actor?.kind === 'owner' && this.actor.scopes.includes('gateway.admin')
        && this.actor.principalId === binding.actorPrincipalId && binding.capabilityTool === toolName
        && endpoint?.endpointId === endpointId && isManagedDeviceCapability(endpoint, toolName)
        && tool && (!tool.descriptor.requiresForeground || endpoint.availability === 'foreground')
        ? endpoint : undefined;
    }
    if (isDeviceFolderTool(toolName)) {
      const selection = this.snapshot(conversationId);
      const owner = this.actor?.kind === 'owner' && this.actor.scopes.includes('gateway.admin');
      const endpoint = selection.target ? selection.resolved : owner ? this.registry.get(endpointId)
        : origin.type === 'endpoint' ? this.registry.get(origin.endpointId) : undefined;
      return endpoint?.endpointId === endpointId
        && deviceFoldersFor(endpoint, this.actor, origin, this.registry).length ? endpoint : undefined;
    }
    if (grant) return this.registry.get(grant.targetEndpointId);
    if (deviceCapabilityTarget(toolName) !== 'turn_origin' && binding) {
      const selected = binding.endpointId === endpointId ? this.snapshot(conversationId).resolved : undefined;
      if (this.actor && this.actor.kind !== 'device' && this.actor.scopes.includes('gateway.admin')) return selected;
      return selected && selected.principalId === originEndpoint?.principalId
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
