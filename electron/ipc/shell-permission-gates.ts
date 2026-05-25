/**
 * Chromium session permission gates aligned with OS media / notification consent.
 */

import { systemPreferences } from 'electron';

import type { TccTriState } from './system-settings-types.js';

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

function isMediaTypeGranted(type: 'microphone' | 'screen' | 'camera'): boolean {
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

/**
 * Whether the renderer may use a Chromium permission that maps to an OS privacy toggle.
 * Prevents auto-granting before TCC / Windows privacy registers the app.
 */
export function isShellChromiumPermissionGranted(permission: string): boolean {
  if (permission === 'media' || permission === 'audioCapture') {
    return isMediaTypeGranted('microphone');
  }

  if (permission === 'display-capture') {
    return isMediaTypeGranted('screen');
  }

  if (permission === 'videoCapture') {
    return isMediaTypeGranted('camera');
  }

  return false;
}
