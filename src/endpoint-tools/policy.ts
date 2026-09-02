import Ajv2020 from 'ajv/dist/2020.js';

import {
  ENDPOINT_CONTACT_LIST_OUTPUT_SCHEMA,
  ENDPOINT_CONTACT_OUTPUT_SCHEMA,
  ENDPOINT_FILE_OUTPUT_SCHEMA,
  ENDPOINT_TEXT_OUTPUT_SCHEMA,
  canonicalJson,
  type EndpointResultKind,
  type EndpointAvailability,
  type EndpointKind,
  type EndpointToolDescriptor,
} from '@xopcai/endpoint-tools-protocol';

export interface EndpointToolPolicyDecision {
  confirmationRequired: boolean;
}

export class EndpointToolPolicyError extends Error {}

interface TrustedToolContract {
  policyId: string;
  outputSchema: Record<string, unknown>;
  resultKinds: EndpointResultKind[];
  permissions: string[];
}

function contract(
  policyId: string,
  outputSchema: Record<string, unknown>,
  resultKinds: EndpointResultKind[],
  permissions: string[],
): TrustedToolContract {
  return { policyId, outputSchema, resultKinds, permissions };
}

const POLICY_BY_TOOL: Readonly<Record<string, TrustedToolContract>> = {
  'web.file.pick': contract('personal.foreground-read', ENDPOINT_FILE_OUTPUT_SCHEMA, ['file'], ['file-read']),
  'web.file.download': contract('user.foreground-write', ENDPOINT_TEXT_OUTPUT_SCHEMA, ['text'], ['file-download']),
  'web.page.get_selection': contract('public.foreground-read', ENDPOINT_TEXT_OUTPUT_SCHEMA, ['text'], []),
  'web.clipboard.write': contract('user.foreground-write', ENDPOINT_TEXT_OUTPUT_SCHEMA, ['text'], ['clipboard-write']),
  'web.page.navigate': contract('user.foreground-write', ENDPOINT_TEXT_OUTPUT_SCHEMA, ['text'], ['navigation']),
  'desktop.file.pick': contract('personal.foreground-read', ENDPOINT_FILE_OUTPUT_SCHEMA, ['file'], ['file-read']),
  'desktop.file.save': contract('user.foreground-write', ENDPOINT_TEXT_OUTPUT_SCHEMA, ['text'], ['file-write']),
  'desktop.notification.show': contract('user.foreground-write', ENDPOINT_TEXT_OUTPUT_SCHEMA, ['text'], ['notifications']),
  'desktop.clipboard.read': contract('personal.foreground-read', ENDPOINT_TEXT_OUTPUT_SCHEMA, ['text'], ['clipboard-read']),
  'desktop.clipboard.write': contract('user.foreground-write', ENDPOINT_TEXT_OUTPUT_SCHEMA, ['text'], ['clipboard-write']),
  'desktop.app.open_external': contract('user.foreground-write', ENDPOINT_TEXT_OUTPUT_SCHEMA, ['text'], ['open-external-url']),
  'mobile.contacts.pick': contract('personal.foreground-read', ENDPOINT_CONTACT_OUTPUT_SCHEMA, ['json'], ['contacts-read-selected']),
  'mobile.contacts.search': contract('personal.foreground-read', ENDPOINT_CONTACT_LIST_OUTPUT_SCHEMA, ['json'], ['contacts-read']),
  'mobile.contacts.get': contract('personal.foreground-read', ENDPOINT_CONTACT_OUTPUT_SCHEMA, ['json'], ['contacts-read']),
  'mobile.file.pick': contract('personal.foreground-read', ENDPOINT_FILE_OUTPUT_SCHEMA, ['file'], ['file-read']),
  'mobile.file.share': contract('user.foreground-write', ENDPOINT_TEXT_OUTPUT_SCHEMA, ['text'], ['file-share']),
  'mobile.notification.show': contract('user.foreground-write', ENDPOINT_TEXT_OUTPUT_SCHEMA, ['text'], ['notifications']),
  'mobile.device.get_info': contract('public.background-read', ENDPOINT_TEXT_OUTPUT_SCHEMA, ['text'], []),
  'mobile.clipboard.write': contract('user.foreground-write', ENDPOINT_TEXT_OUTPUT_SCHEMA, ['text'], ['clipboard-write']),
  'mobile.app.open_url': contract('user.foreground-write', ENDPOINT_TEXT_OUTPUT_SCHEMA, ['text'], ['open-external-url']),
};

export class EndpointToolPolicy {
  private readonly ajv = new Ajv2020({ allErrors: true, strict: true });

  validateDescriptor(kind: EndpointKind, descriptor: EndpointToolDescriptor): void {
    if (!descriptor.name.startsWith(`${kind}.`)) {
      throw new EndpointToolPolicyError(`Tool ${descriptor.name} does not belong to ${kind}`);
    }
    const contract = POLICY_BY_TOOL[descriptor.name];
    if (!contract) throw new EndpointToolPolicyError(`Tool ${descriptor.name} has no trusted server policy`);
    if (descriptor.policyId !== contract.policyId) {
      throw new EndpointToolPolicyError(`Tool ${descriptor.name} does not match its trusted server policy`);
    }
    if (
      canonicalJson(descriptor.outputSchema) !== canonicalJson(contract.outputSchema)
      || canonicalJson(descriptor.resultKinds) !== canonicalJson(contract.resultKinds)
      || canonicalJson([...descriptor.requiredPermissions].sort()) !== canonicalJson([...contract.permissions].sort())
    ) {
      throw new EndpointToolPolicyError(`Tool ${descriptor.name} does not match its trusted server contract`);
    }
    this.validatePolicyFields(descriptor);
    try {
      this.ajv.compile(descriptor.outputSchema);
    } catch (error) {
      throw new EndpointToolPolicyError(
        `Tool ${descriptor.name} has an invalid output schema: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  evaluate(
    descriptor: EndpointToolDescriptor,
    availability: EndpointAvailability,
  ): EndpointToolPolicyDecision {
    if (descriptor.requiresForeground && availability !== 'foreground') {
      throw new EndpointToolPolicyError('Endpoint is not in the foreground');
    }
    return { confirmationRequired: descriptor.confirmation === 'always' };
  }

  private validatePolicyFields(descriptor: EndpointToolDescriptor): void {
    switch (descriptor.policyId) {
      case 'public.background-read':
        this.assertFields(descriptor, 'read', 'never', false, 'public');
        return;
      case 'public.foreground-read':
        this.assertFields(descriptor, 'read', 'never', true, 'public');
        return;
      case 'personal.foreground-read':
        this.assertFields(descriptor, 'read', 'always', true, 'personal');
        if (descriptor.requiredPermissions.length === 0) {
          throw new EndpointToolPolicyError(`Personal tool ${descriptor.name} must declare a permission`);
        }
        return;
      case 'user.foreground-write':
        if (descriptor.effect === 'read') {
          throw new EndpointToolPolicyError(`Mutating tool ${descriptor.name} cannot declare a read effect`);
        }
        if (
          descriptor.confirmation !== 'always'
          || !descriptor.requiresForeground
          || descriptor.sensitivity !== 'personal'
          || descriptor.requiredPermissions.length === 0
        ) {
          throw new EndpointToolPolicyError(`Mutating tool ${descriptor.name} violates its trusted policy`);
        }
        return;
      default:
        throw new EndpointToolPolicyError(`Unknown endpoint policy: ${descriptor.policyId}`);
    }
  }

  private assertFields(
    descriptor: EndpointToolDescriptor,
    effect: EndpointToolDescriptor['effect'],
    confirmation: EndpointToolDescriptor['confirmation'],
    requiresForeground: boolean,
    sensitivity: EndpointToolDescriptor['sensitivity'],
  ): void {
    if (
      descriptor.effect !== effect
      || descriptor.confirmation !== confirmation
      || descriptor.requiresForeground !== requiresForeground
      || descriptor.sensitivity !== sensitivity
    ) {
      throw new EndpointToolPolicyError(`Tool ${descriptor.name} violates its trusted policy`);
    }
  }
}
