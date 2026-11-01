import './thread-stream-bundle-shim.js';

// Load logger dependencies only after their bundled worker path is configured.
if (process.argv.includes('--gateway-connections')) {
  const { startGatewayConnectionPreview } = await import('./gateway/connection-entry.js');
  // Electron emits ready only after the entry module finishes evaluating.
  void startGatewayConnectionPreview(import.meta.url).catch(async () => {
    console.error('[GatewayConnections] Preview startup failed; restart without --gateway-connections for local mode.');
    const { app } = await import('electron');
    app.quit();
  });
} else {
  await import('./main.js');
}
