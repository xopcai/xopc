import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktopShell', Object.freeze({
  bootstrap: () => ipcRenderer.invoke('shell:bootstrap'),
  recover: () => ipcRenderer.invoke('shell:recover'),
}));
