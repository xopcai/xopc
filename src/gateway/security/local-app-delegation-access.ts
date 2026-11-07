import type { CapabilityContext } from '../../capabilities/runtime/dispatcher.js';
import { CapabilityError } from '../../capabilities/runtime/errors.js';
import { isBrowserSessionActive } from '../../storage/sqlite/browser-session-repository.js';
import { getDevice, isDeviceAccessSessionActive } from '../../storage/sqlite/device-access-repository.js';
import type { ResolvedGatewayAuth } from '../auth.js';
import type { GatewayPrincipal } from './gateway-principal.js';

/** Long-running inference never retains a revoked HTTP identity. */
export function localAppDelegationCaller(context: CapabilityContext, principal: GatewayPrincipal, getAuth: () => ResolvedGatewayAuth): CapabilityContext {
  const initialAuth = JSON.stringify(getAuth());
  return { ...context, assertCurrent: () => {
    context.assertCurrent?.();
    const auth = getAuth();
    if (JSON.stringify(auth) !== initialAuth || principal.browserSessionId && !isBrowserSessionActive(principal.browserSessionId, auth)) {
      throw new CapabilityError('FORBIDDEN', 'Delegation caller authorization ended');
    }
    if (principal.kind === 'device') {
      const device = principal.deviceId ? getDevice(principal.deviceId) : undefined;
      if (!device || device.revokedAt !== undefined || !principal.accessSessionId
        || !isDeviceAccessSessionActive(device.id, principal.accessSessionId)
        || !principal.scopes.every(scope => device.scopes.includes(scope))) {
        throw new CapabilityError('FORBIDDEN', 'Delegation device authorization ended');
      }
    }
  } };
}
