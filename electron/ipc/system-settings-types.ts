/**
 * Shared types for system-settings IPC (main process). Renderers mirror in web types.
 */

export type TccTriState = 'granted' | 'denied' | 'unknown';

export type MacosPermissionSnapshot = {
  fullDisk: TccTriState;
  screen: TccTriState;
  microphone: TccTriState;
  accessibility: TccTriState;
  /** No reliable TCC read; best-effort or unknown. */
  automation: TccTriState;
  notifications: TccTriState;
  location: TccTriState;
};

export type MacosPrivacyPaneKind =
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
  openAtLogin: boolean;
  openAsHidden: boolean;
  keepAwakeEnabled: boolean;
  keepAwakePreferred: boolean;
  notifyEnabled: boolean;
  notifySoundEnabled: boolean;
};
