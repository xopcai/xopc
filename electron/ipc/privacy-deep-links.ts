import { shell } from 'electron';

import type { PrivacyPaneKind } from './system-settings-types.js';

/** Prefer Ventura+ System Settings URLs; fall back to legacy System Preferences anchors. */
const MACOS_PRIVACY_URLS: Record<PrivacyPaneKind, string[]> = {
  fullDisk: [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
  ],
  screen: [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  ],
  microphone: [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  ],
  accessibility: [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  ],
  automation: [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Automation',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
  ],
  notifications: [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Notifications',
    'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Notifications',
  ],
  location: [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_LocationServices',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices',
  ],
  camera: [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Camera',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  ],
};

/** @see https://learn.microsoft.com/en-us/windows/uwp/launch-resume/launch-app-for-settings */
const WIN_SETTINGS_URLS: Record<PrivacyPaneKind, string> = {
  fullDisk: 'ms-settings:privacy-broadfilesystemaccess',
  screen: 'ms-settings:privacy-screencapture',
  microphone: 'ms-settings:privacy-microphone',
  accessibility: 'ms-settings:accessibility',
  automation: 'ms-settings:defaultapps',
  notifications: 'ms-settings:notifications',
  location: 'ms-settings:privacy-location',
  camera: 'ms-settings:privacy-webcam',
};

const WIN_SETTINGS_FALLBACKS: Partial<Record<PrivacyPaneKind, string>> = {
  fullDisk: 'ms-settings:privacy',
  screen: 'ms-settings:display',
};

export async function openMacosPrivacyPane(kind: PrivacyPaneKind): Promise<boolean> {
  const urls = MACOS_PRIVACY_URLS[kind] ?? MACOS_PRIVACY_URLS.microphone;
  for (const url of urls) {
    try {
      await shell.openExternal(url);
      return true;
    } catch {
      /* try next URL */
    }
  }
  return false;
}

export async function openWinPrivacyPane(kind: PrivacyPaneKind): Promise<boolean> {
  const primary = WIN_SETTINGS_URLS[kind];
  if (primary) {
    try {
      await shell.openExternal(primary);
      return true;
    } catch {
      /* try fallback */
    }
  }
  const fallback = WIN_SETTINGS_FALLBACKS[kind];
  if (fallback) {
    try {
      await shell.openExternal(fallback);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
