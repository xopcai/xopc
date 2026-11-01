import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('gatewayConnections', Object.freeze({
  snapshot: () => ipcRenderer.invoke('connections:snapshot'),
  save: (epoch: number, profile: unknown) => ipcRenderer.invoke('connections:save', epoch, profile),
  connect: (epoch: number, id: string) => ipcRenderer.invoke('connections:connect', epoch, id),
  select: (epoch: number, id: string) => ipcRenderer.invoke('connections:select', epoch, id),
  remove: (epoch: number, id: string) => ipcRenderer.invoke('connections:remove', epoch, id),
  enrollDesktop: (epoch: number, id: string) => ipcRenderer.invoke('connections:desktop-enroll', epoch, id),
  checkDesktop: (epoch: number, id: string) => ipcRenderer.invoke('connections:desktop-check', epoch, id),
  disableDesktop: (epoch: number, id: string) => ipcRenderer.invoke('connections:desktop-disable', epoch, id),
  reenrollDesktop: (epoch: number, id: string) => ipcRenderer.invoke('connections:desktop-reenroll', epoch, id),
  startObservation: (epoch: number, id: string) => ipcRenderer.invoke('connections:observation-start', epoch, id),
  startScreenObservation: (epoch: number, id: string) => ipcRenderer.invoke('connections:screen-start', epoch, id),
  startExecution: (epoch: number, id: string) => ipcRenderer.invoke('connections:execution-start', epoch, id),
  stopExecution: () => ipcRenderer.invoke('connections:execution-stop'),
  stopObservation: () => ipcRenderer.invoke('connections:observation-stop'),
  useLocal: () => ipcRenderer.invoke('connections:local'),
  quit: () => ipcRenderer.invoke('connections:quit'),
}));
