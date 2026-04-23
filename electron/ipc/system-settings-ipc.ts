/**
 * Electron shell: login item, power save blocker, notification preferences (userData),
 * and macOS privacy helpers (TCC / System Settings).
 */

import { constants as fsConstants, access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type IpcMain, type IpcMainInvokeEvent, app, powerSaveBlocker, shell, systemPreferences } from 'electron';

import type {
  MacosPermissionSnapshot,
  MacosPrivacyPaneKind,
  SystemSettingsBehavior,
  TccTriState,
} from './system-settings-types.js';

const PREFS_NAME = 'electron-shell-prefs.json';

type ElectronShellPreferences = {
  keepAwakePreferred: boolean;
  notifyEnabled: boolean;
  notifySoundEnabled: boolean;
};

const defaultPrefs: ElectronShellPreferences = {
  keepAwakePreferred: false,
  notifyEnabled: true,
  notifySoundEnabled: true,
};

let prefs: ElectronShellPreferences = { ...defaultPrefs };
let prefsPath: string | null = null;
let powerBlockerId: number | null = null;
let loaded = false;

function resolvePrefsPath(): string {
  if (prefsPath) {
    return prefsPath;
  }
  prefsPath = join(app.getPath('userData'), PREFS_NAME);
  return prefsPath;
}

async function readPrefsFile(): Promise<ElectronShellPreferences> {
  const path = resolvePrefsPath();
  try {
    const raw = await readFile(path, 'utf-8');
    const j = JSON.parse(raw) as Partial<ElectronShellPreferences>;
    return {
      keepAwakePreferred: typeof j.keepAwakePreferred === 'boolean' ? j.keepAwakePreferred : defaultPrefs.keepAwakePreferred,
      notifyEnabled: typeof j.notifyEnabled === 'boolean' ? j.notifyEnabled : defaultPrefs.notifyEnabled,
      notifySoundEnabled: typeof j.notifySoundEnabled === 'boolean' ? j.notifySoundEnabled : defaultPrefs.notifySoundEnabled,
    };
  } catch {
    return { ...defaultPrefs };
  }
}

async function writePrefsFile(next: ElectronShellPreferences): Promise<void> {
  await writeFile(resolvePrefsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
}

/**
 * Call after `app` is ready. Restores keep-awake from disk.
 */
export async function initElectronShellPreferences(): Promise<void> {
  if (loaded) {
    return;
  }
  loaded = true;
  prefs = await readPrefsFile();
  applyKeepAwakeFromPref();
}

function applyKeepAwakeFromPref(): void {
  if (powerBlockerId != null) {
    powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
  }
  if (prefs.keepAwakePreferred) {
    powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  }
}

export function stopAllPowerSaveBlockers(): void {
  if (powerBlockerId != null) {
    powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
  }
}

function tccToTriState(s: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown' | string): TccTriState {
  if (s === 'granted') {
    return 'granted';
  }
  if (s === 'denied' || s === 'restricted') {
    return 'denied';
  }
  return 'unknown';
}

function mapMediaStatus(type: 'microphone' | 'screen' | 'camera'): TccTriState {
  try {
    const s = systemPreferences.getMediaAccessStatus(type);
    return tccToTriState(s);
  } catch {
    return 'unknown';
  }
}

async function probeFullDiskAccess(): Promise<TccTriState> {
  if (process.platform !== 'darwin') {
    return 'unknown';
  }
  const probe = join(app.getPath('home'), 'Library/Mail');
  try {
    await access(probe, fsConstants.R_OK);
    return 'granted';
  } catch (e) {
    const c = (e as NodeJS.ErrnoException).code;
    if (c === 'EACCES' || c === 'EPERM') {
      return 'denied';
    }
    return 'unknown';
  }
}

function accessibilityState(): TccTriState {
  try {
    if (systemPreferences.isTrustedAccessibilityClient(false)) {
      return 'granted';
    }
    return 'denied';
  } catch {
    return 'unknown';
  }
}

function unknownMacos(): MacosPermissionSnapshot {
  return {
    fullDisk: 'unknown',
    screen: 'unknown',
    microphone: 'unknown',
    accessibility: 'unknown',
    automation: 'unknown',
    notifications: 'unknown',
    location: 'unknown',
  };
}

async function buildMacosSnapshot(): Promise<MacosPermissionSnapshot> {
  if (process.platform !== 'darwin') {
    return unknownMacos();
  }
  const fullDisk = await probeFullDiskAccess();
  const screen = mapMediaStatus('screen');
  const microphone = mapMediaStatus('microphone');
  return {
    fullDisk,
    screen,
    microphone,
    accessibility: accessibilityState(),
    automation: 'unknown',
    notifications: 'unknown',
    location: 'unknown',
  };
}

/**
 * System Settings / System Preferences deep links. Behavior can differ by macOS version.
 * @see https://github.com/sindresorhus/preferences-urls
 */
const MACOS_PRIVACY_URLS: Record<MacosPrivacyPaneKind, string> = {
  fullDisk: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
  notifications: 'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
  location: 'x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
};

function getBehaviorState(): SystemSettingsBehavior {
  const login = app.getLoginItemSettings();
  return {
    platform: process.platform as 'darwin' | 'win32' | 'linux',
    openAtLogin: login.openAtLogin,
    openAsHidden: login.openAsHidden ?? false,
    keepAwakeEnabled: powerBlockerId != null,
    keepAwakePreferred: prefs.keepAwakePreferred,
    notifyEnabled: prefs.notifyEnabled,
    notifySoundEnabled: prefs.notifySoundEnabled,
  };
}

export function registerSystemSettingsIpc(ipcMain: IpcMain): void {
  ipcMain.handle('system-settings:get-behavior', (): SystemSettingsBehavior => getBehaviorState());

  ipcMain.handle(
    'system-settings:set-behavior',
    async (
      _e: IpcMainInvokeEvent,
      patch: Partial<{
        openAtLogin: boolean;
        openAsHidden: boolean;
        keepAwakePreferred: boolean;
        notifyEnabled: boolean;
        notifySoundEnabled: boolean;
      }>,
    ): Promise<{ ok: true; behavior: SystemSettingsBehavior }> => {
      if (typeof patch.openAtLogin === 'boolean' || typeof patch.openAsHidden === 'boolean') {
        const cur = app.getLoginItemSettings();
        app.setLoginItemSettings({
          openAtLogin: typeof patch.openAtLogin === 'boolean' ? patch.openAtLogin : cur.openAtLogin,
          openAsHidden: typeof patch.openAsHidden === 'boolean' ? patch.openAsHidden : (cur.openAsHidden ?? false),
        });
      }
      if (typeof patch.keepAwakePreferred === 'boolean') {
        prefs = { ...prefs, keepAwakePreferred: patch.keepAwakePreferred };
        await writePrefsFile(prefs);
        applyKeepAwakeFromPref();
      }
      if (typeof patch.notifyEnabled === 'boolean' || typeof patch.notifySoundEnabled === 'boolean') {
        prefs = {
          ...prefs,
          ...(typeof patch.notifyEnabled === 'boolean' ? { notifyEnabled: patch.notifyEnabled } : {}),
          ...(typeof patch.notifySoundEnabled === 'boolean' ? { notifySoundEnabled: patch.notifySoundEnabled } : {}),
        };
        await writePrefsFile(prefs);
      }
      return { ok: true, behavior: getBehaviorState() };
    },
  );

  ipcMain.handle('system-settings:get-macos-permissions', async (): Promise<MacosPermissionSnapshot> => {
    if (process.platform !== 'darwin') {
      return unknownMacos();
    }
    return buildMacosSnapshot();
  });

  ipcMain.handle('system-settings:open-macos-privacy', (_e: IpcMainInvokeEvent, kind: MacosPrivacyPaneKind) => {
    if (process.platform !== 'darwin') {
      return { ok: false as const, error: 'not_darwin' };
    }
    const u = MACOS_PRIVACY_URLS[kind];
    if (!u) {
      return { ok: false as const, error: 'unknown_kind' };
    }
    void shell.openExternal(u);
    return { ok: true as const };
  });

  ipcMain.handle('system-settings:request-microphone', async (): Promise<{ status: TccTriState }> => {
    if (process.platform !== 'darwin') {
      return { status: 'unknown' };
    }
    try {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      return { status: granted ? 'granted' : 'denied' };
    } catch {
      return { status: mapMediaStatus('microphone') };
    }
  });
}
