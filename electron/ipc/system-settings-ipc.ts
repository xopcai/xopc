/**
 * Electron shell: login item, power save blocker, notification preferences (userData),
 * and OS-specific privacy / settings helpers (TCC on macOS, getMediaAccessStatus on win32/darwin,
 * deep links on Windows, GNOME on Linux with documentation fallback).
 */

import { execFile } from 'node:child_process';
import { constants as fsConstants, access, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';

import { type IpcMain, type IpcMainInvokeEvent, app, powerSaveBlocker, shell, systemPreferences } from 'electron';

import type { PrivacyPaneKind, ShellPermissionSnapshot, SystemSettingsBehavior, TccTriState } from './system-settings-types.js';

const execFileAsync = promisify(execFile);

const PREFS_NAME = 'electron-shell-prefs.json';

const LINUX_HELP_URL = 'https://xopcai.github.io/xopc/';

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

function tccToTriState(s: string): TccTriState {
  if (s === 'granted') {
    return 'granted';
  }
  if (s === 'denied' || s === 'restricted') {
    return 'denied';
  }
  return 'unknown';
}

function mapMediaStatusWhenAvailable(type: 'microphone' | 'screen' | 'camera'): TccTriState {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return 'unknown';
  }
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
  if (process.platform !== 'darwin') {
    return 'unknown';
  }
  try {
    if (systemPreferences.isTrustedAccessibilityClient(false)) {
      return 'granted';
    }
    return 'denied';
  } catch {
    return 'unknown';
  }
}

function unknownAll(): ShellPermissionSnapshot {
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

async function buildSnapshotDarwin(): Promise<ShellPermissionSnapshot> {
  const fullDisk = await probeFullDiskAccess();
  return {
    fullDisk,
    screen: mapMediaStatusWhenAvailable('screen'),
    microphone: mapMediaStatusWhenAvailable('microphone'),
    accessibility: accessibilityState(),
    automation: 'unknown',
    notifications: 'unknown',
    location: 'unknown',
  };
}

/**
 * getMediaAccessStatus is documented for win32,darwin. Screen often reports granted on Windows; mic/camera reflect privacy toggles.
 */
function buildSnapshotWin32(): ShellPermissionSnapshot {
  return {
    fullDisk: 'unknown',
    screen: mapMediaStatusWhenAvailable('screen'),
    microphone: mapMediaStatusWhenAvailable('microphone'),
    /** Win32: no TCC; global accessibility policies differ. */
    accessibility: 'unknown',
    automation: 'unknown',
    notifications: 'unknown',
    location: 'unknown',
  };
}

function buildSnapshotLinux(): ShellPermissionSnapshot {
  const base = unknownAll();
  /** Electron documents getMediaAccessStatus for win32/darwin; some Linux builds may still expose it. */
  try {
    base.microphone = tccToTriState(systemPreferences.getMediaAccessStatus('microphone'));
    base.screen = tccToTriState(systemPreferences.getMediaAccessStatus('screen'));
  } catch {
    /* leave unknown */
  }
  return base;
}

async function getPermissionSnapshot(): Promise<ShellPermissionSnapshot> {
  if (process.platform === 'darwin') {
    return buildSnapshotDarwin();
  }
  if (process.platform === 'win32') {
    return buildSnapshotWin32();
  }
  return buildSnapshotLinux();
}

const MACOS_PRIVACY_URLS: Record<PrivacyPaneKind, string> = {
  fullDisk: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
  notifications: 'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
  location: 'x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
};

/** @see https://learn.microsoft.com/en-us/windows/uwp/launch-resume/launch-app-for-settings */
const WIN_SETTINGS_URLS: Record<PrivacyPaneKind, string> = {
  fullDisk: 'ms-settings:storage',
  screen: 'ms-settings:display',
  microphone: 'ms-settings:privacy-microphone',
  accessibility: 'ms-settings:accessibility',
  automation: 'ms-settings:defaultapps',
  notifications: 'ms-settings:notifications',
  location: 'ms-settings:privacy-location',
  camera: 'ms-settings:privacy-webcam',
};

/** `gnome-control-center` (first arg = panel) — best effort across distros. */
const LINUX_GNOME_ARGS: Record<PrivacyPaneKind, [string, ...string[]] | [string]> = {
  fullDisk: ['privacy'],
  screen: ['display'],
  microphone: ['sound'],
  accessibility: ['universal-access'],
  automation: ['keyboard'],
  notifications: ['notifications'],
  location: ['location'],
  camera: ['privacy'],
};

async function openLinuxPrivacyPanel(kind: PrivacyPaneKind): Promise<void> {
  const args = LINUX_GNOME_ARGS[kind] ?? (['privacy'] as [string]);
  const primary = args[0];
  try {
    await execFileAsync('gnome-control-center', [primary, ...args.slice(1)], { windowsHide: true, timeout: 5_000 });
  } catch {
    try {
      void (await execFileAsync('unity-control-center', [primary, ...args.slice(1)], { windowsHide: true, timeout: 3_000 }));
    } catch {
      void shell.openExternal(LINUX_HELP_URL);
    }
  }
}

function openPrivacyForPlatform(kind: PrivacyPaneKind): void {
  if (process.platform === 'darwin') {
    const u = MACOS_PRIVACY_URLS[kind];
    if (u) {
      void shell.openExternal(u);
    }
    return;
  }
  if (process.platform === 'win32') {
    const u = WIN_SETTINGS_URLS[kind];
    if (u) {
      void shell.openExternal(u);
    }
    return;
  }
  if (process.platform === 'linux') {
    void openLinuxPrivacyPanel(kind);
  }
}

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

  const permissionsHandler = async (): Promise<ShellPermissionSnapshot> => {
    if (process.platform === 'linux') {
      return buildSnapshotLinux();
    }
    if (process.platform === 'win32') {
      return buildSnapshotWin32();
    }
    if (process.platform === 'darwin') {
      return await buildSnapshotDarwin();
    }
    return unknownAll();
  };

  ipcMain.handle('system-settings:get-permissions', permissionsHandler);

  const openHandler = (_e: IpcMainInvokeEvent, kind: PrivacyPaneKind) => {
    openPrivacyForPlatform(kind);
    return { ok: true as const };
  };

  ipcMain.handle('system-settings:open-privacy', openHandler);

  ipcMain.handle('system-settings:request-microphone', async (): Promise<{ status: TccTriState }> => {
    if (process.platform === 'darwin') {
      try {
        const granted = await systemPreferences.askForMediaAccess('microphone');
        return { status: granted ? 'granted' : 'denied' };
      } catch {
        return { status: mapMediaStatusWhenAvailable('microphone') };
      }
    }
    if (process.platform === 'win32' || process.platform === 'linux') {
      return { status: mapMediaStatusWhenAvailable('microphone') };
    }
    return { status: 'unknown' };
  });
}
