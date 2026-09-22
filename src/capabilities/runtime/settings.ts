import { ProductReadContracts } from '@xopcai/gateway-contract';

import { defineReadCapability, type CapabilityDispatcher } from './dispatcher.js';

/** A navigation suggestion, not configuration access or authority to move a client tab. */
export function registerSettingsCapability(dispatcher: CapabilityDispatcher): void {
  dispatcher.register(defineReadCapability({
    id: 'xopc.settings.open', majorVersion: 1, description: 'Suggest a relative settings target without reading or changing configuration.',
    effect: 'read', surfaces: ['http', 'agent', 'cli'], scopes: ['gateway.status'],
    ...ProductReadContracts['xopc.settings.open'],
    execute: input => ({ ok: true as const, settings: input }),
  }));
}
