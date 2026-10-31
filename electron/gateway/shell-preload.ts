import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktopShell', Object.freeze({
  bootstrap: () => ipcRenderer.invoke('shell:bootstrap'),
  readState: () => ipcRenderer.invoke('shell:state-read'),
  writeState: (value: unknown) => ipcRenderer.invoke('shell:state-write', value),
  recover: () => ipcRenderer.invoke('shell:recover'),
}));
