/**
 * Chromium session permission gates aligned with OS media / notification consent.
 */

import { systemPreferences } from 'electron';

import { isEmbeddedGatewayLoopbackUrl } from '../loopback-url.js';
import type { TccTriState } from './system-settings-types.js';

type OsMediaAccessType = 'microphone' | 'screen' | 'camera';

export interface ShellPermissionDetails {
  mediaType?: 'video' | 'audio' | 'unknown';
  mediaTypes?: Array<'video' | 'audio'>;
}

export function tccToTriState(s: string): TccTriState {
  if (s === 'granted') {
    return 'granted';
  }
  if (s === 'denied' || s === 'restricted') {
    return 'denied';
  }
  return 'unknown';
}

export function rawMediaAccessStatus(type: 'microphone' | 'screen' | 'camera'): string {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return 'unknown';
  }
  try {
    return systemPreferences.getMediaAccessStatus(type);
  } catch {
    return 'unknown';
  }
}

function linuxMediaGranted(type: 'microphone' | 'screen' | 'camera'): boolean {
  try {
    return systemPreferences.getMediaAccessStatus(type) === 'granted';
  } catch {
    return true;
  }
}

function isMediaTypeGranted(type: OsMediaAccessType): boolean {
  const raw = rawMediaAccessStatus(type);
  if (process.platform === 'win32') {
    return raw !== 'denied' && raw !== 'restricted';
  }
  if (process.platform === 'darwin') {
    return raw === 'granted';
  }
  if (process.platform === 'linux') {
    return linuxMediaGranted(type);
  }
  return false;
}

export function isTrustedShellPermissionRequest(urls: Array<string | null | undefined>): boolean {
  const origins = urls
    .filter((url): url is string => Boolean(url))
    .map((url) => {
      if (!isEmbeddedGatewayLoopbackUrl(url)) return null;
      try {
        return new URL(url).origin;
      } catch {
        return null;
      }
    });
  return origins.length > 0
    && origins.every((origin): origin is string => origin !== null)
    && new Set(origins).size === 1;
}

export function requiredOsMediaAccessTypes(
  permission: string,
  details: ShellPermissionDetails = {},
): OsMediaAccessType[] {
  if (permission === 'audioCapture') return ['microphone'];
  if (permission === 'videoCapture') return ['camera'];
  if (permission === 'display-capture') return ['screen'];
  if (permission !== 'media') return [];

  const requested = details.mediaTypes
    ?? (details.mediaType && details.mediaType !== 'unknown' ? [details.mediaType] : []);
  return [...new Set(requested.map((type) => type === 'audio' ? 'microphone' : 'camera'))];
}

/**
 * Whether the renderer may use a Chromium permission that maps to an OS privacy toggle.
 * Prevents auto-granting before TCC / Windows privacy registers the app.
 */
export function isShellChromiumPermissionGranted(
  permission: string,
  details: ShellPermissionDetails = {},
): boolean {
  const requiredTypes = requiredOsMediaAccessTypes(permission, details);
  return requiredTypes.length > 0 && requiredTypes.every(isMediaTypeGranted);
}
