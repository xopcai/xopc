import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
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
  platform: process.platform as 'darwin' | 'win32' | 'linux',
});
