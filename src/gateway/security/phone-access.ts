import { getDevice, isDeviceAccessSessionActive } from '../../storage/sqlite/device-access-repository.js';
import { PhoneError } from '../../phone/contracts.js';
import type { GatewayPrincipal } from './gateway-principal.js';

export function phoneAdministrator(principal: GatewayPrincipal): boolean {
  return principal.kind !== 'device' && principal.scopes.includes('gateway.admin');
}

/** Reload mutable device grants even for already established streams. */
export function authorizePhoneAccess(principal: GatewayPrincipal, control = false): void {
  if (phoneAdministrator(principal)) return;
  const device = principal.deviceId ? getDevice(principal.deviceId) : undefined;
  if (principal.kind !== 'device' || !device || device.platform === 'chrome' || !principal.accessSessionId
    || !isDeviceAccessSessionActive(device.id, principal.accessSessionId)) {
    throw new PhoneError('PHONE_ACCESS_REVOKED', 'Phone access is unavailable for this device', 403);
  }
  const required = ['sessions.read', 'phone.view', ...(control ? ['sessions.write', 'phone.control'] : [])];
  if (!required.every(scope => device.scopes.includes(scope as typeof device.scopes[number]))) {
    throw new PhoneError('PHONE_PERMISSION_REQUIRED', 'Authorize phone access in Gateway device settings', 403);
  }
}
