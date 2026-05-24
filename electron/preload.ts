import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  shell: {
    openPath: (filePath: string) =>
      ipcRenderer.invoke('shell:open-path', filePath) as Promise<{ error?: string }>,
    showItemInFolder: (filePath: string) =>
      ipcRenderer.invoke('shell:show-item-in-folder', filePath) as Promise<{ success: boolean }>,
  },
  file: {
    readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath) as Promise<string>,
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke('file:write', filePath, content) as Promise<{ success: boolean }>,
    listDirectory: (dirPath: string) =>
      ipcRenderer.invoke('file:list-dir', dirPath) as Promise<
        Array<{ name: string; path: string; isDirectory: boolean }>
      >,
    openDirectory: (options?: { defaultPath?: string }) =>
      ipcRenderer.invoke('file:open-dir-dialog', options) as Promise<string | null>,
    watchFile: (filePath: string, callback: (content: string) => void) => {
      const handler = (_: unknown, payload: { path: string; content: string }) => {
        if (payload.path === filePath) callback(payload.content);
      };
      ipcRenderer.on('file:changed', handler);
      void ipcRenderer.invoke('file:watch', filePath);
    },
  },
  search: {
    ripgrep: (query: string, dirPath: string) =>
      ipcRenderer.invoke('search:ripgrep', query, dirPath) as Promise<
        Array<{
          filePath: string;
          lineNumber: number;
          lineContent: string;
          matchStart: number;
          matchEnd: number;
        }>
      >,
  },
  agent: {
    sendMessage: (message: string, sessionKey: string) =>
      ipcRenderer.invoke('agent:send', message, sessionKey) as Promise<{ done: boolean; error?: string }>,
    onStream: (callback: (chunk: string) => void) => {
      ipcRenderer.on('agent:stream-chunk', (_, chunk: string) => callback(chunk));
    },
  },
  startup: {
    onFailed: (callback: (detail: { message: string }) => void) => {
      const handler = (_: unknown, detail: { message: string }) => callback(detail);
      ipcRenderer.on('startup:failed', handler);
      return () => ipcRenderer.removeListener('startup:failed', handler);
    },
  },
  gateway: {
    onExited: (callback: (detail: { code: number | null; signal: string | null }) => void) => {
      const handler = (_: unknown, detail: { code: number | null; signal: string | null }) => callback(detail);
      ipcRenderer.on('gateway:exited', handler);
      return () => ipcRenderer.removeListener('gateway:exited', handler);
    },
    restart: () =>
      ipcRenderer.invoke('gateway:restart') as Promise<{ ok: boolean; message?: string }>,
  },
  updater: {
    getStatus: () =>
      ipcRenderer.invoke('updater:get-status') as Promise<{
        state: string;
        version?: string;
        releaseNotes?: string;
        percent?: number;
        bytesPerSecond?: number;
        transferred?: number;
        total?: number;
        message?: string;
      }>,
    check: () => ipcRenderer.invoke('updater:check') as Promise<{ ok: boolean }>,
    quitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install') as Promise<{ ok: boolean }>,
    onStatusChanged: (
      callback: (status: {
        state: string;
        version?: string;
        releaseNotes?: string;
        percent?: number;
        bytesPerSecond?: number;
        transferred?: number;
        total?: number;
        message?: string;
      }) => void,
    ) => {
      const handler = (_: unknown, status: Record<string, unknown>) => callback(status as never);
      ipcRenderer.on('updater:status-changed', handler);
      return () => ipcRenderer.removeListener('updater:status-changed', handler);
    },
  },
  platform: process.platform as 'darwin' | 'win32' | 'linux',
  menu: {
    onNavigate: (callback: (path: string) => void) => {
      const handler = (_: unknown, path: string) => callback(path);
      ipcRenderer.on('menu:navigate', handler);
      return () => ipcRenderer.removeListener('menu:navigate', handler);
    },
    onTogglePalette: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:toggle-palette', handler);
      return () => ipcRenderer.removeListener('menu:toggle-palette', handler);
    },
  },
  cron: {
    setDisplaySleepPrevented: (enabled: boolean) =>
      ipcRenderer.invoke('cron:set-prevent-display-sleep', enabled) as Promise<void>,
  },
  system: {
    getBehavior: () => ipcRenderer.invoke('system-settings:get-behavior'),
    setBehavior: (patch: {
      openAtLogin?: boolean;
      openAsHidden?: boolean;
      keepAwakePreferred?: boolean;
      notifyEnabled?: boolean;
      notifySoundEnabled?: boolean;
    }) => ipcRenderer.invoke('system-settings:set-behavior', patch),
    getPermissions: () => ipcRenderer.invoke('system-settings:get-permissions'),
    openPrivacy: (
      kind:
        | 'fullDisk'
        | 'screen'
        | 'microphone'
        | 'accessibility'
        | 'automation'
        | 'notifications'
        | 'location'
        | 'camera',
    ) => ipcRenderer.invoke('system-settings:open-privacy', kind),
    requestMicrophone: () => ipcRenderer.invoke('system-settings:request-microphone'),
    requestAccessibility: () => ipcRenderer.invoke('system-settings:request-accessibility'),
    getUninstallInfo: () => ipcRenderer.invoke('system-settings:get-uninstall-info'),
    clearUserData: () => ipcRenderer.invoke('system-settings:clear-user-data'),
    uninstallApp: (options?: { removeUserData?: boolean }) =>
      ipcRenderer.invoke('system-settings:uninstall-app', options),
  },
});
