import type { ModelSetupUse } from '@xopcai/gateway-contract';

/** Open settings without unmounting the active conversation or recording. */
export function openCapabilitySettings(use: ModelSetupUse, view: 'settings' | 'services' = 'settings', purpose?: 'phone' | 'automation') {
  window.dispatchEvent(new CustomEvent('open-capability-settings', { detail: { use, view, purpose } }));
}
