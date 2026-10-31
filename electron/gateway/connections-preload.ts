import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('gatewayConnections', Object.freeze({
  snapshot: () => ipcRenderer.invoke('connections:snapshot'),
  save: (epoch: number, profile: unknown) => ipcRenderer.invoke('connections:save', epoch, profile),
  select: (epoch: number, id: string) => ipcRenderer.invoke('connections:select', epoch, id),
  remove: (epoch: number, id: string) => ipcRenderer.invoke('connections:remove', epoch, id),
  useLocal: () => ipcRenderer.invoke('connections:local'),
  quit: () => ipcRenderer.invoke('connections:quit'),
}));
