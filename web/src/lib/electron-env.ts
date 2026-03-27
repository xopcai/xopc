/** True when running inside Electron with preload bridge (not gateway-only web). */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electronAPI);
}
