/**
 * Electron shell: login item, power save blocker, notification preferences (userData),
 * and OS-specific privacy / settings helpers (TCC on macOS, getMediaAccessStatus on win32/darwin,
 * deep links on Windows, GNOME on Linux with documentation fallback).
 */

import { execFile } from 'node:child_process';
import { constants as fsConstants, access, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';

import { type IpcMain, type IpcMainInvokeEvent, app, desktopCapturer, Notification, powerSaveBlocker, shell, systemPreferences } from 'electron';

import type { PrivacyPaneKind, ShellPermissionSnapshot, SystemSettingsBehavior, TccTriState, PermissionRequestResult } from './system-settings-types.js';
import { rawMediaAccessStatus, tccToTriState } from './shell-permission-gates.js';
import { openMacosPrivacyPane, openWinPrivacyPane } from './privacy-deep-links.js';
import { assertTrustedRenderer } from './trusted-renderer.js';
import { normalizeElectronUiLanguage, type ElectronUiLanguage } from '../i18n.js';

const execFileAsync = promisify(execFile);

const PREFS_NAME = 'electron-shell-prefs.json';

const LINUX_HELP_URL = 'https://xopcai.github.io/xopc/';

type ElectronShellPreferences = {
  keepAwakePreferred: boolean;
  notifyEnabled: boolean;
  notifySoundEnabled: boolean;
  language?: ElectronUiLanguage;
  /** Best-effort macOS UNUserNotificationCenter status after probe / request. */
  notificationAuthStatus?: TccTriState;
};

type EndpointNotificationInput = { title: string; body: string };
type AgentRunNotificationInput = EndpointNotificationInput & { id: string; route: string };

const defaultPrefs: ElectronShellPreferences = {
  keepAwakePreferred: false,
  notifyEnabled: true,
  notifySoundEnabled: true,
};

let prefs: ElectronShellPreferences = { ...defaultPrefs };
let prefsPath: string | null = null;
let powerBlockerId: number | null = null;
let loaded = false;
const activeAgentRunNotifications = new Set<Notification>();

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
      language: j.language === 'en' || j.language === 'zh' ? j.language : undefined,
      notificationAuthStatus:
        j.notificationAuthStatus === 'granted' || j.notificationAuthStatus === 'denied' || j.notificationAuthStatus === 'unknown'
          ? j.notificationAuthStatus
          : undefined,
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

export function getElectronShellLanguage(): ElectronUiLanguage {
  return normalizeElectronUiLanguage(prefs.language, app.getLocale());
}

async function setElectronShellLanguage(language: unknown): Promise<ElectronUiLanguage> {
  const next = normalizeElectronUiLanguage(language, app.getLocale());
  if (prefs.language === next) {
    return next;
  }
  prefs = { ...prefs, language: next };
  await writePrefsFile(prefs);
  return next;
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

/** Used by main-process session permission handlers (renderer Notification API). */
export function isShellNotificationGranted(): boolean {
  return prefs.notificationAuthStatus === 'granted';
}

async function persistNotificationAuthStatus(status: TccTriState): Promise<void> {
  if (prefs.notificationAuthStatus === status) {
    return;
  }
  prefs = { ...prefs, notificationAuthStatus: status };
  await writePrefsFile(prefs);
}

function notificationAccessState(): TccTriState {
  return prefs.notificationAuthStatus ?? 'unknown';
}

function parseEndpointNotificationInput(input: unknown): EndpointNotificationInput | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2) {
    return undefined;
  }
  const { title, body } = input as { title?: unknown; body?: unknown };
  if (
    typeof title !== 'string'
    || !title.trim()
    || title.length > 120
    || typeof body !== 'string'
    || !body.trim()
    || body.length > 500
  ) {
    return undefined;
  }
  return { title, body };
}

function parseAgentRunNotificationInput(input: unknown): AgentRunNotificationInput | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 4) {
    return undefined;
  }
  const { id, title, body, route } = input as Record<string, unknown>;
  const text = parseEndpointNotificationInput({ title, body });
  if (
    !text
    || typeof id !== 'string'
    || !id.trim()
    || id.length > 160
    || typeof route !== 'string'
    || !route.startsWith('/chat/')
    || route.length > 1_000
  ) return undefined;
  return { id, route, ...text };
}

function mapMediaStatusWhenAvailable(type: 'microphone' | 'screen' | 'camera'): TccTriState {
  return tccToTriState(rawMediaAccessStatus(type));
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
    // API cannot distinguish not-determined from denied.
    return 'unknown';
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
    notifications: notificationAccessState(),
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
    notifications: notificationAccessState(),
    location: 'unknown',
  };
}

function buildSnapshotLinux(): ShellPermissionSnapshot {
  const base = unknownAll();
  base.notifications = notificationAccessState();
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

const LINUX_PANEL_COMMANDS: Partial<Record<PrivacyPaneKind, Array<{ cmd: string; args: string[] }>>> = {
  fullDisk: [{ cmd: 'gnome-control-center', args: ['privacy'] }],
  screen: [
    { cmd: 'gnome-control-center', args: ['display'] },
    { cmd: 'systemsettings', args: ['kcm_screensaver'] },
  ],
  microphone: [
    { cmd: 'gnome-control-center', args: ['sound'] },
    { cmd: 'systemsettings', args: ['kcm_pulseaudio'] },
  ],
  accessibility: [
    { cmd: 'gnome-control-center', args: ['universal-access'] },
    { cmd: 'systemsettings', args: ['kcmaccess'] },
  ],
  automation: [
    { cmd: 'gnome-control-center', args: ['keyboard'] },
    { cmd: 'systemsettings', args: ['kcm_keyboard'] },
  ],
  notifications: [
    { cmd: 'gnome-control-center', args: ['notifications'] },
    { cmd: 'systemsettings', args: ['kcm_notifications'] },
  ],
  location: [{ cmd: 'gnome-control-center', args: ['location'] }],
  camera: [{ cmd: 'gnome-control-center', args: ['privacy'] }],
};

async function openLinuxPrivacyPanel(kind: PrivacyPaneKind): Promise<void> {
  const commands = LINUX_PANEL_COMMANDS[kind] ?? [{ cmd: 'gnome-control-center', args: ['privacy'] }];
  for (const { cmd, args } of commands) {
    try {
      await execFileAsync(cmd, args, { windowsHide: true, timeout: 5_000 });
      return;
    } catch {
      /* try next desktop environment */
    }
  }
  try {
    await execFileAsync('unity-control-center', ['privacy'], { windowsHide: true, timeout: 3_000 });
    return;
  } catch {
    void shell.openExternal(LINUX_HELP_URL);
  }
}

async function openPrivacyForPlatform(kind: PrivacyPaneKind): Promise<boolean> {
  if (process.platform === 'darwin') {
    return openMacosPrivacyPane(kind);
  }
  if (process.platform === 'win32') {
    return openWinPrivacyPane(kind);
  }
  if (process.platform === 'linux') {
    await openLinuxPrivacyPanel(kind);
    return true;
  }
  return false;
}

async function requestMicrophoneAccess(): Promise<PermissionRequestResult> {
  if (process.platform === 'darwin') {
    const raw = rawMediaAccessStatus('microphone');
    if (raw === 'granted') {
      return { status: 'granted', outcome: 'already-granted' };
    }
    if (raw === 'denied' || raw === 'restricted') {
      await openMacosPrivacyPane('microphone');
      return { status: 'denied', outcome: 'opened-settings' };
    }
    try {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      return {
        status: granted ? 'granted' : mapMediaStatusWhenAvailable('microphone'),
        outcome: granted ? 'granted' : 'denied',
      };
    } catch {
      return {
        status: mapMediaStatusWhenAvailable('microphone'),
        outcome: 'denied',
      };
    }
  }
  if (process.platform === 'win32') {
    const raw = rawMediaAccessStatus('microphone');
    if (raw === 'denied' || raw === 'restricted') {
      await openWinPrivacyPane('microphone');
      return { status: 'denied', outcome: 'opened-settings' };
    }
    return { status: mapMediaStatusWhenAvailable('microphone'), outcome: 'prompted' };
  }
  await openLinuxPrivacyPanel('microphone');
  return { status: mapMediaStatusWhenAvailable('microphone'), outcome: 'opened-settings' };
}

async function requestScreenAccess(): Promise<PermissionRequestResult> {
  const currentScreenStatus = (): TccTriState => mapMediaStatusWhenAvailable('screen');

  if (process.platform === 'darwin') {
    const raw = rawMediaAccessStatus('screen');
    if (raw === 'granted') {
      return { status: 'granted', outcome: 'already-granted' };
    }
    if (raw === 'denied' || raw === 'restricted') {
      await openMacosPrivacyPane('screen');
      return { status: 'denied', outcome: 'opened-settings' };
    }
    try {
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      const status = currentScreenStatus();
      return {
        status,
        outcome: status === 'granted' ? 'granted' : 'prompted',
      };
    } catch {
      const status = currentScreenStatus();
      if (status === 'denied') {
        await openMacosPrivacyPane('screen');
        return { status: 'denied', outcome: 'opened-settings' };
      }
      return { status, outcome: 'prompted' };
    }
  }

  if (process.platform === 'win32') {
    const raw = rawMediaAccessStatus('screen');
    if (raw === 'granted') {
      return { status: 'granted', outcome: 'already-granted' };
    }
    if (raw === 'denied' || raw === 'restricted') {
      await openWinPrivacyPane('screen');
      return { status: 'denied', outcome: 'opened-settings' };
    }
    try {
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    } catch {
      /* capture prompt may still update OS state */
    }
    return { status: currentScreenStatus(), outcome: 'prompted' };
  }

  await openLinuxPrivacyPanel('screen');
  return { status: currentScreenStatus(), outcome: 'opened-settings' };
}

async function requestAccessibilityAccess(): Promise<PermissionRequestResult> {
  if (process.platform === 'darwin') {
    if (accessibilityState() === 'granted') {
      return { status: 'granted', outcome: 'already-granted' };
    }
    try {
      if (systemPreferences.isTrustedAccessibilityClient(true)) {
        return { status: 'granted', outcome: 'granted' };
      }
    } catch {
      /* fall through to System Settings */
    }
    await openMacosPrivacyPane('accessibility');
    return { status: accessibilityState(), outcome: 'opened-settings' };
  }
  if (process.platform === 'win32') {
    await openWinPrivacyPane('accessibility');
    return { status: 'unknown', outcome: 'opened-settings' };
  }
  await openLinuxPrivacyPanel('accessibility');
  return { status: 'unknown', outcome: 'opened-settings' };
}

const NOTIFICATION_PROBE_TIMEOUT_MS = 4_000;

/**
 * Post a silent native notification to detect OS notification authorization.
 * First call may show the system permission dialog (macOS / some Linux builds).
 */
async function probeNotificationAccess(): Promise<TccTriState> {
  if (!Notification.isSupported()) {
    return 'unknown';
  }

  const status = await new Promise<TccTriState>((resolve) => {
    const notification = new Notification({
      title: 'xopc',
      body: ' ',
      silent: true,
    });
    let settled = false;
    const finish = (next: TccTriState) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        notification.close();
      } catch {
        /* ignore */
      }
      resolve(next);
    };
    const timer = setTimeout(() => finish(notificationAccessState()), NOTIFICATION_PROBE_TIMEOUT_MS);
    notification.once('show', () => finish('granted'));
    notification.once('failed', () => finish('denied'));
    notification.show();
  });

  await persistNotificationAuthStatus(status);
  return status;
}

async function requestNotificationAccess(): Promise<PermissionRequestResult> {
  if (!Notification.isSupported()) {
    return { status: 'unknown', outcome: 'denied' };
  }

  if (process.platform === 'darwin') {
    const cached = notificationAccessState();
    if (cached === 'granted') {
      return { status: 'granted', outcome: 'already-granted' };
    }
    if (cached === 'denied') {
      await openMacosPrivacyPane('notifications');
      return { status: 'denied', outcome: 'opened-settings' };
    }
    const status = await probeNotificationAccess();
    if (status === 'granted') {
      return { status: 'granted', outcome: 'granted' };
    }
    if (status === 'denied') {
      await openMacosPrivacyPane('notifications');
      return { status: 'denied', outcome: 'opened-settings' };
    }
    return { status: 'unknown', outcome: 'prompted' };
  }

  if (process.platform === 'win32') {
    const cached = notificationAccessState();
    if (cached === 'granted') {
      return { status: 'granted', outcome: 'already-granted' };
    }
    if (cached === 'denied') {
      await openWinPrivacyPane('notifications');
      return { status: 'denied', outcome: 'opened-settings' };
    }
    const status = await probeNotificationAccess();
    if (status === 'granted') {
      return { status: 'granted', outcome: 'granted' };
    }
    if (status === 'denied') {
      await openWinPrivacyPane('notifications');
      return { status: 'denied', outcome: 'opened-settings' };
    }
    return { status: 'unknown', outcome: 'prompted' };
  }

  const cached = notificationAccessState();
  if (cached === 'granted') {
    return { status: 'granted', outcome: 'already-granted' };
  }
  if (cached === 'denied') {
    await openLinuxPrivacyPanel('notifications');
    return { status: 'denied', outcome: 'opened-settings' };
  }
  const status = await probeNotificationAccess();
  if (status === 'granted') {
    return { status: 'granted', outcome: 'granted' };
  }
  if (status === 'denied') {
    await openLinuxPrivacyPanel('notifications');
    return { status: 'denied', outcome: 'opened-settings' };
  }
  return { status: 'unknown', outcome: 'prompted' };
}

function getBehaviorState(): SystemSettingsBehavior {
  const login = app.getLoginItemSettings();
  return {
    platform: process.platform as 'darwin' | 'win32' | 'linux',
    packaged: app.isPackaged,
    openAtLogin: login.openAtLogin,
    openAsHidden: login.openAsHidden ?? false,
    keepAwakeEnabled: powerBlockerId != null,
    keepAwakePreferred: prefs.keepAwakePreferred,
    notifyEnabled: prefs.notifyEnabled,
    notifySoundEnabled: prefs.notifySoundEnabled,
  };
}

export function registerSystemSettingsIpc(
  ipcMain: IpcMain,
  options?: {
    onLanguageChanged?: (language: ElectronUiLanguage) => void;
    isMainWindowFocused?: () => boolean;
    navigateMainWindow?: (route: string) => void;
  },
): void {
  ipcMain.handle('system-settings:get-behavior', (event): SystemSettingsBehavior => {
    assertTrustedRenderer(event);
    return getBehaviorState();
  });

  ipcMain.handle('electron-locale:get', (event): ElectronUiLanguage => {
    assertTrustedRenderer(event);
    return getElectronShellLanguage();
  });

  ipcMain.handle(
    'electron-locale:set',
    async (event: IpcMainInvokeEvent, language: unknown): Promise<{ ok: true; language: ElectronUiLanguage }> => {
      assertTrustedRenderer(event);
      const before = getElectronShellLanguage();
      const next = await setElectronShellLanguage(language);
      if (next !== before) {
        options?.onLanguageChanged?.(next);
      }
      return { ok: true, language: next };
    },
  );

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
      assertTrustedRenderer(_e);
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

  const permissionsHandler = async (
    event: IpcMainInvokeEvent,
    options?: { probe?: boolean },
  ): Promise<ShellPermissionSnapshot> => {
    assertTrustedRenderer(event);
    if (options?.probe) {
      await probeNotificationAccess();
    }
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

  const openHandler = async (event: IpcMainInvokeEvent, kind: PrivacyPaneKind) => {
    assertTrustedRenderer(event);
    const ok = await openPrivacyForPlatform(kind);
    return ok ? ({ ok: true as const }) : ({ ok: false as const, error: 'OPEN_SETTINGS_FAILED' });
  };

  ipcMain.handle('system-settings:open-privacy', openHandler);

  ipcMain.handle('system-settings:request-microphone', async (event): Promise<PermissionRequestResult> => {
    assertTrustedRenderer(event);
    return requestMicrophoneAccess();
  });

  ipcMain.handle('system-settings:request-accessibility', async (event): Promise<PermissionRequestResult> => {
    assertTrustedRenderer(event);
    return requestAccessibilityAccess();
  });

  ipcMain.handle('system-settings:request-notifications', async (event): Promise<PermissionRequestResult> => {
    assertTrustedRenderer(event);
    return requestNotificationAccess();
  });

  ipcMain.handle(
    'system-settings:show-endpoint-notification',
    (event, input: unknown): { ok: true } | { ok: false; error: string } => {
      assertTrustedRenderer(event);
      const notificationInput = parseEndpointNotificationInput(input);
      if (!notificationInput) return { ok: false, error: 'INVALID_ARGUMENTS' };
      if (!prefs.notifyEnabled) return { ok: false, error: 'NOTIFICATIONS_DISABLED' };
      if (!Notification.isSupported()) return { ok: false, error: 'NOTIFICATIONS_UNSUPPORTED' };
      if (!isShellNotificationGranted()) return { ok: false, error: 'PERMISSION_DENIED' };
      try {
        new Notification({ ...notificationInput, silent: !prefs.notifySoundEnabled }).show();
        return { ok: true };
      } catch {
        return { ok: false, error: 'NOTIFICATION_FAILED' };
      }
    },
  );

  ipcMain.handle(
    'system-settings:show-agent-run-notification',
    (event, input: unknown): { ok: true; outcome: 'shown' | 'suppressed-focused' } | { ok: false; error: string } => {
      assertTrustedRenderer(event);
      const notificationInput = parseAgentRunNotificationInput(input);
      if (!notificationInput) return { ok: false, error: 'INVALID_ARGUMENTS' };
      if (!prefs.notifyEnabled) return { ok: false, error: 'NOTIFICATIONS_DISABLED' };
      if (options?.isMainWindowFocused?.()) return { ok: true, outcome: 'suppressed-focused' };
      if (!Notification.isSupported()) return { ok: false, error: 'NOTIFICATIONS_UNSUPPORTED' };
      if (!isShellNotificationGranted()) return { ok: false, error: 'PERMISSION_DENIED' };
      try {
        const notification = new Notification({
          title: notificationInput.title,
          body: notificationInput.body,
          silent: !prefs.notifySoundEnabled,
        });
        activeAgentRunNotifications.add(notification);
        const release = () => activeAgentRunNotifications.delete(notification);
        notification.once('close', release);
        notification.once('failed', release);
        notification.once('click', () => {
          release();
          options?.navigateMainWindow?.(notificationInput.route);
        });
        notification.show();
        return { ok: true, outcome: 'shown' };
      } catch {
        return { ok: false, error: 'NOTIFICATION_FAILED' };
      }
    },
  );

  ipcMain.handle('system-settings:request-screen', async (event): Promise<PermissionRequestResult> => {
    assertTrustedRenderer(event);
    return requestScreenAccess();
  });

  ipcMain.handle('system-settings:get-uninstall-info', async (event) => {
    assertTrustedRenderer(event);
    const { getUninstallInfo } = await import('../uninstall/get-uninstall-info.js');
    return getUninstallInfo();
  });

  ipcMain.handle('system-settings:clear-user-data', async (event) => {
    assertTrustedRenderer(event);
    const { clearUserData } = await import('../uninstall/clear-user-data.js');
    return clearUserData();
  });

  ipcMain.handle(
    'system-settings:uninstall-app',
    async (event: IpcMainInvokeEvent, options?: { removeUserData?: boolean }) => {
      assertTrustedRenderer(event);
      const { uninstallApp } = await import('../uninstall/index.js');
      return uninstallApp({ removeUserData: options?.removeUserData === true });
    },
  );
}
