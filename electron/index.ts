import './thread-stream-bundle-shim.js';

// Load logger dependencies only after their bundled worker path is configured.
if (process.argv.includes('--xopc-private-browser-worker')) {
  const { startDesktopBrowserWorker } = await import('./desktop/browser-worker.js');
  void startDesktopBrowserWorker().catch(error => {
    console.error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'DESKTOP_BROWSER_WORKER_START_FAILED'); process.exit(1);
  });
} else if (process.argv.includes('--gateway-connections')) {
  const { startGatewayConnectionPreview } = await import('./gateway/connection-entry.js');
  // Electron emits ready only after the entry module finishes evaluating.
  void startGatewayConnectionPreview(import.meta.url).catch(async () => {
    console.error('[GatewayConnections] Preview startup failed; restart without --gateway-connections for local mode.');
    const { recoverGatewayConnectionStartup } = await import('./gateway/startup-recovery.js');
    await recoverGatewayConnectionStartup();
  });
} else {
  await import('./main.js');
}
