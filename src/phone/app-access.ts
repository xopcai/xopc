import { PhoneError } from './contracts.js';

export type PhoneAppAccess = { appAccess?: 'all' | 'selected'; allowedApps: string[] };

/** Preserve legacy allowlists while new connections default to all applications. */
export function phoneAppAccess(device: PhoneAppAccess): 'all' | 'selected' {
  return device.appAccess ?? (device.allowedApps.length ? 'selected' : 'all');
}
export function phoneAllowsApp(device: PhoneAppAccess, application: string): boolean {
  return phoneAppAccess(device) === 'all' || device.allowedApps.includes(application);
}
export function normalizePhoneAppAccess<T extends PhoneAppAccess>(device: T): T & { appAccess: 'all' | 'selected' } {
  const appAccess = phoneAppAccess(device);
  if (appAccess === 'selected' && !device.allowedApps.length) throw new PhoneError('PHONE_APPS_REQUIRED', 'Select at least one application');
  return { ...device, appAccess, allowedApps: appAccess === 'all' ? [] : [...new Set(device.allowedApps)] };
}
