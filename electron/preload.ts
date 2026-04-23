import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  shell: {
    openPath: (filePath: string) =>
      ipcRenderer.invoke('shell:open-path', filePath) as Promise<{ error?: string }>,
  },
  file: {
    readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath) as Promise<string>,
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke('file:write', filePath, content) as Promise<{ success: boolean }>,
    listDirectory: (dirPath: string) =>
      ipcRenderer.invoke('file:list-dir', dirPath) as Promise<
        Array<{ name: string; path: string; isDirectory: boolean }>
      >,
    openDirectory: () => ipcRenderer.invoke('file:open-dir-dialog') as Promise<string | null>,
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
  },
  platform: process.platform as 'darwin' | 'win32' | 'linux',
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
  },
});
