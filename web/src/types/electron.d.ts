export interface ElectronOpenDirectoryOptions {
  defaultPath?: string;
}

export interface ElectronFileAPI {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<{ success: boolean }>;
  listDirectory(dirPath: string): Promise<
    Array<{ name: string; path: string; isDirectory: boolean }>
  >;
  openDirectory(options?: ElectronOpenDirectoryOptions): Promise<string | null>;
  watchFile(filePath: string, callback: (content: string) => void): void;
}

export interface ElectronSearchAPI {
  ripgrep(
    query: string,
    dirPath: string,
  ): Promise<
    Array<{
      filePath: string;
      lineNumber: number;
      lineContent: string;
      matchStart: number;
      matchEnd: number;
    }>
  >;
}

export interface ElectronAgentAPI {
  sendMessage(message: string, sessionKey: string): Promise<{ done: boolean; error?: string }>;
  onStream(callback: (chunk: string) => void): void;
}

export interface ElectronStartupAPI {
  onFailed(callback: (detail: { message: string }) => void): () => void;
}

export interface ElectronGatewayShellAPI {
  onExited(callback: (detail: { code: number | null; signal: string | null }) => void): () => void;
  restart(): Promise<{ ok: boolean; message?: string; token?: string; port?: number }>;
}

export type ElectronShellOpenResult =
  | { ok: true; error?: undefined; code?: undefined }
  | {
      ok: false;
      error: string;
      code?: 'CANCELED' | 'INVALID_PATH' | 'NOT_FOUND' | 'NOT_FILE' | 'INVALID_APP' | 'OPEN_FAILED' | string;
    };

export type ElectronRecentOpenWithApp = {
  name: string;
  path: string;
  platform: 'darwin' | 'win32' | 'linux' | string;
  lastUsedAt: number;
};

export type ElectronRecommendedOpenWithApp = {
  name: string;
  path: string;
  platform: 'darwin' | 'win32' | 'linux' | string;
  source: 'known';
};

export interface ElectronShellAPI {
  openPath(filePath: string): Promise<ElectronShellOpenResult>;
  showItemInFolder(filePath: string): Promise<{ success: boolean }>;
  chooseAppAndOpenPath(filePath: string): Promise<ElectronShellOpenResult>;
  openPathWithApp(filePath: string, appPath: string): Promise<ElectronShellOpenResult>;
  getRecentOpenWithApps(): Promise<ElectronRecentOpenWithApp[]>;
  getOpenWithAppsForPath(filePath: string): Promise<{
    recommended: ElectronRecommendedOpenWithApp[];
    recent: ElectronRecentOpenWithApp[];
  }>;
  clearRecentOpenWithApps(): Promise<{ ok: true }>;
}

export interface ElectronClipboardAPI {
  writeText(text: string): Promise<boolean>;
  readText(): Promise<string>;
}

export type TccTriState = 'granted' | 'denied' | 'unknown';

export type ShellPermissionSnapshot = {
  fullDisk: TccTriState;
  screen: TccTriState;
  microphone: TccTriState;
  accessibility: TccTriState;
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
  openAtLogin: boolean;
  openAsHidden: boolean;
  keepAwakeEnabled: boolean;
  keepAwakePreferred: boolean;
  notifyEnabled: boolean;
  notifySoundEnabled: boolean;
};

export type UninstallMode = 'manual' | 'native-uninstaller' | 'unsupported';

export type LinuxPackageKind = 'appimage' | 'deb' | 'unknown';

export type UninstallErrorCode =
  | 'PENDING_UPDATE'
  | 'NOT_PACKAGED'
  | 'UNINSTALLER_NOT_FOUND'
  | 'PLATFORM_UNSUPPORTED';

export type UninstallInfo = {
  packaged: boolean;
  platform: 'darwin' | 'win32' | 'linux';
  uninstallMode: UninstallMode;
  appPath: string;
  userDataPath: string;
  userDataSizeBytes: number | null;
  hasSeparateCliData: boolean;
  cliDataPath: string | null;
  uninstallerPath: string | null;
  pendingUpdate: boolean;
  linuxPackageKind?: LinuxPackageKind;
  linuxDebPackageName?: string;
};

export type UninstallAppResult =
  | {
      ok: true;
      mode: 'manual' | 'native-uninstaller';
      linuxPackageKind?: LinuxPackageKind;
      debPackageName?: string;
    }
  | { ok: false; error: UninstallErrorCode };

export type ClearUserDataResult = { ok: true } | { ok: false; error: UninstallErrorCode };

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

export interface ElectronMenuAPI {
  onNavigate(callback: (path: string) => void): () => void;
  onTogglePalette(callback: () => void): () => void;
}

export interface ElectronCronDisplayWakeAPI {
  setDisplaySleepPrevented(enabled: boolean): Promise<void>;
}

export interface ElectronFullscreenAPI {
  enter(): Promise<void>;
  exit(): Promise<void>;
  toggle(): Promise<void>;
  isFullscreen(): Promise<boolean>;
  onChange(callback: (isFullscreen: boolean) => void): () => void;
}

export interface ElectronSystemSettingsAPI {
  getBehavior(): Promise<SystemSettingsBehavior>;
  setBehavior(patch: {
    openAtLogin?: boolean;
    openAsHidden?: boolean;
    keepAwakePreferred?: boolean;
    notifyEnabled?: boolean;
    notifySoundEnabled?: boolean;
  }): Promise<{ ok: true; behavior: SystemSettingsBehavior }>;
  getPermissions(options?: { probe?: boolean }): Promise<ShellPermissionSnapshot>;
  openPrivacy(
    kind: PrivacyPaneKind,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  requestMicrophone(): Promise<PermissionRequestResult>;
  requestAccessibility(): Promise<PermissionRequestResult>;
  requestNotifications(): Promise<PermissionRequestResult>;
  requestScreen(): Promise<PermissionRequestResult>;
  getUninstallInfo(): Promise<UninstallInfo>;
  clearUserData(): Promise<ClearUserDataResult>;
  uninstallApp(options?: { removeUserData?: boolean }): Promise<UninstallAppResult>;
}

export interface ElectronAPI {
  clipboard?: ElectronClipboardAPI;
  shell?: ElectronShellAPI;
  file: ElectronFileAPI;
  search: ElectronSearchAPI;
  agent: ElectronAgentAPI;
  startup?: ElectronStartupAPI;
  gateway?: ElectronGatewayShellAPI;
  platform: 'darwin' | 'win32' | 'linux';
  menu?: ElectronMenuAPI;
  cron?: ElectronCronDisplayWakeAPI;
  fullscreen?: ElectronFullscreenAPI;
  system?: ElectronSystemSettingsAPI;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
