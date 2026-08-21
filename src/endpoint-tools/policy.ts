import type {
  EndpointAvailability,
  EndpointKind,
  EndpointToolDescriptor,
} from '@xopcai/endpoint-tools-protocol';

export interface EndpointToolPolicyDecision {
  confirmationRequired: boolean;
}

export class EndpointToolPolicyError extends Error {}

export class EndpointToolPolicy {
  validateDescriptor(kind: EndpointKind, descriptor: EndpointToolDescriptor): void {
    if (!descriptor.name.startsWith(`${kind}.`)) {
      throw new EndpointToolPolicyError(`Tool ${descriptor.name} does not belong to ${kind}`);
    }
    if (descriptor.effect !== 'read') {
      if (descriptor.confirmation !== 'always') {
        throw new EndpointToolPolicyError(`Mutating tool ${descriptor.name} must always require confirmation`);
      }
      if (!descriptor.requiresForeground) {
        throw new EndpointToolPolicyError(`Mutating tool ${descriptor.name} must require foreground`);
      }
      if (descriptor.requiredPermissions.length === 0) {
        throw new EndpointToolPolicyError(`Mutating tool ${descriptor.name} must declare a permission`);
      }
    }
  }

  evaluate(
    descriptor: EndpointToolDescriptor,
    availability: EndpointAvailability,
  ): EndpointToolPolicyDecision {
    if (descriptor.requiresForeground && availability !== 'foreground') {
      throw new EndpointToolPolicyError('Endpoint is not in the foreground');
    }
    return {
      confirmationRequired:
        descriptor.confirmation === 'always' || descriptor.effect !== 'read',
    };
  }
}
