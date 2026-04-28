export interface ElectronFileAPI {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<{ success: boolean }>;
  listDirectory(dirPath: string): Promise<
    Array<{ name: string; path: string; isDirectory: boolean }>
  >;
  openDirectory(): Promise<string | null>;
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
}

export interface ElectronShellAPI {
  openPath(filePath: string): Promise<{ error?: string }>;
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
  openAtLogin: boolean;
  openAsHidden: boolean;
  keepAwakeEnabled: boolean;
  keepAwakePreferred: boolean;
  notifyEnabled: boolean;
  notifySoundEnabled: boolean;
};

export interface ElectronMenuAPI {
  onNavigate(callback: (path: string) => void): () => void;
  onTogglePalette(callback: () => void): () => void;
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
  getPermissions(): Promise<ShellPermissionSnapshot>;
  openPrivacy(
    kind: PrivacyPaneKind,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  requestMicrophone(): Promise<{ status: TccTriState }>;
}

export interface ElectronAPI {
  shell?: ElectronShellAPI;
  file: ElectronFileAPI;
  search: ElectronSearchAPI;
  agent: ElectronAgentAPI;
  startup?: ElectronStartupAPI;
  gateway?: ElectronGatewayShellAPI;
  platform: 'darwin' | 'win32' | 'linux';
  menu?: ElectronMenuAPI;
  system?: ElectronSystemSettingsAPI;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
