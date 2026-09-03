/**
 * Shared types for system-settings IPC (main process). Renderers mirror in web types.
 */

export type TccTriState = 'granted' | 'denied' | 'unknown';

/** Best-effort permission / consent flags (TCC on macOS, where supported on win32, else unknown on linux). */
export type ShellPermissionSnapshot = {
  fullDisk: TccTriState;
  screen: TccTriState;
  microphone: TccTriState;
  accessibility: TccTriState;
  /** No reliable read on most systems; use open-privacy. */
  automation: TccTriState;
  notifications: TccTriState;
  location: TccTriState;
};

export type PrivacyPaneKind =
  | 'fullDisk'
  | 'screen'
  | 'microphone'
  | 'accessibility'
  | 'automation'
  | 'notifications'
  | 'location'
  | 'camera';

export type SystemSettingsBehavior = {
  platform: 'darwin' | 'win32' | 'linux';
  /** False when running unpackaged (e.g. electron:dev); macOS privacy lists may show "Electron". */
  packaged: boolean;
  runInBackground: boolean;
  backgroundSupported: boolean;
  openAtLogin: boolean;
  openAsHidden: boolean;
  keepAwakeEnabled: boolean;
  keepAwakePreferred: boolean;
  notifyEnabled: boolean;
  notifySoundEnabled: boolean;
};

export type PermissionRequestOutcome =
  | 'granted'
  | 'denied'
  | 'prompted'
  | 'opened-settings'
  | 'already-granted';

export type PermissionRequestResult = {
  status: TccTriState;
  outcome: PermissionRequestOutcome;
};
