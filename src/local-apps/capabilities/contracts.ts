import { ExtensionCapabilityBindingsSchema } from '@xopcai/gateway-contract';
import { CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import { registerNoteReadCapabilities } from '../../notes/capabilities/read.js';
import { registerNoteWriteCapabilities } from '../../notes/capabilities/write.js';
import { registerTaskReadCapabilities } from '../../tasks/capabilities/read.js';
import { registerLocalAppDelegation } from './delegate.js';
import { registerAutomationReadCapabilities } from '../../automations/capabilities/read.js';
import { registerAutomationWriteCapabilities } from '../../automations/capabilities/write.js';
import type { AutomationService } from '../../automations/service/automation-service.js';
import { registerAutomationProposalCapabilities } from '../automation-proposals.js';
import { registerAutomationDraftCapabilities } from '../../automations/capabilities/drafts.js';
import { registerProjectReadCapabilities } from '../../projects/capabilities/read.js';
import { registerProjectWriteCapabilities } from '../../projects/capabilities/write.js';
import { registerTaskWriteCapabilities } from '../../tasks/capabilities/write.js';
import { registerTaskManagementCapabilities } from '../../tasks/capabilities/management.js';
import type { ProjectService } from '../../projects/project-service.js';
import { registerLocalAppP1Capabilities } from '../p1-services.js';

/** Validate release bindings against the same production definitions without executing a domain service. */
export function validateLocalAppCapabilityContracts(value: unknown): void {
  const bindings = ExtensionCapabilityBindingsSchema.parse(value ?? []);
  if (!bindings.length) return;
  const dispatcher = new CapabilityDispatcher();
  const unavailable = (): never => { throw new Error('Contract validation must not execute a domain service'); };
  registerNoteReadCapabilities(dispatcher, unavailable);
  registerNoteWriteCapabilities(dispatcher, { getNotes: unavailable });
  registerTaskReadCapabilities(dispatcher);
  registerLocalAppDelegation(dispatcher);
  const service = new Proxy({} as AutomationService, { get: () => unavailable });
  registerAutomationReadCapabilities(dispatcher, service);
  registerAutomationWriteCapabilities(dispatcher, service);
  registerAutomationDraftCapabilities(dispatcher, service);
  registerAutomationProposalCapabilities(dispatcher);
  const projects = new Proxy({} as ProjectService, { get: () => unavailable });
  registerProjectReadCapabilities(dispatcher, projects);
  registerProjectWriteCapabilities(dispatcher, projects);
  registerTaskWriteCapabilities(dispatcher, {});
  registerTaskManagementCapabilities(dispatcher);
  registerLocalAppP1Capabilities(dispatcher, { getConfig: unavailable, getFiles: unavailable });
  const context = { principalId: 'release-validator', surface: 'extension' as const, scopes: ['gateway.admin'] as const, authorize: () => false };
  for (const binding of bindings) {
    const descriptor = dispatcher.describe(binding.id, context);
    if (descriptor.majorVersion !== binding.majorVersion || descriptor.descriptorDigest !== binding.descriptorDigest) {
      throw new Error(`Capability contract changed: ${binding.id}; update the binding and rerun acceptance`);
    }
  }
}
