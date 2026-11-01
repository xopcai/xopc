/** Local lock/suspend revokes in-memory grants; unlock never restores them. */
export function installDesktopSessionBoundary(source: {
  on(event: 'lock-screen' | 'suspend', listener: () => void): unknown;
  removeListener(event: 'lock-screen' | 'suspend', listener: () => void): unknown;
}, stop: () => void): () => void {
  source.on('lock-screen', stop); source.on('suspend', stop);
  return () => { source.removeListener('lock-screen', stop); source.removeListener('suspend', stop); };
}
