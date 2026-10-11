import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';

import type { DeviceGrantService } from './grant-service.js';
import { deviceCapabilityTarget } from './capability-catalog.js';
import type { EndpointBindingService } from './binding-service.js';
import type { EndpointRegistry } from './registry.js';

export class DeviceTargetResolver {
  constructor(private readonly registry: EndpointRegistry, private readonly bindings: EndpointBindingService, private readonly grants?: DeviceGrantService) {}

  candidates(conversationId: string, origin: TurnOrigin) {
    const source = origin.type === 'endpoint' ? this.registry.get(origin.endpointId) : undefined;
    const binding = this.bindings.get(conversationId);
    const execution = binding ? this.bindings.resolve(conversationId) : source;
    const authorized = (this.grants?.candidates(conversationId, origin) ?? []).map(grant => this.registry.get(grant.targetEndpointId));
    return [...new Map([source, execution, ...authorized].filter(endpoint => endpoint !== undefined)
      .map(endpoint => [endpoint.endpointId, endpoint])).values()];
  }

  resolve(conversationId: string, origin: TurnOrigin, endpointId: string, toolName: string) {
    const grant = this.grants?.find(conversationId, origin, endpointId, toolName);
    if (grant) return this.registry.get(grant.targetEndpointId);
    const binding = this.bindings.get(conversationId);
    const targetId = deviceCapabilityTarget(toolName) === 'turn_origin'
      ? origin.type === 'endpoint' ? origin.endpointId : undefined
      : binding?.endpointId ?? (origin.type === 'endpoint' ? origin.endpointId : undefined);
    return targetId === endpointId ? this.registry.get(endpointId) : undefined;
  }
}
