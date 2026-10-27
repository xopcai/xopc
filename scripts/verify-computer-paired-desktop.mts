/** Production desktop endpoint, with private metadata-only benchmark control. */
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { DesktopEndpointHost } from '../electron/computer/desktop-host.js';

async function main() {
  app.setPath('userData', join(process.env.XOPC_STATE_DIR!, 'electron'));
  await app.whenReady(); console.error('PAIR_DESKTOP_READY'); app.setActivationPolicy('accessory');
  const window = new BrowserWindow({ width: 320, height: 120, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await window.loadURL('data:text/html,<p>XOPC disposable UI benchmark endpoint</p>');
  console.error('PAIR_DESKTOP_PAGE_LOADED');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); window.showInactive();
  const host = new DesktopEndpointHost({ connection: () => ({ port: Number(process.env.XOPC_PAIR_PROXY_PORT), token: process.env.XOPC_PAIR_TOKEN! }), window: () => window });
  // Test principal only: no existing keychain identity is accessed or persisted.
  if (process.env.XOPC_PAIR_EPHEMERAL_IDENTITY === '1') {
  const pair = generateKeyPairSync('ec', {namedCurve:'prime256v1'});
  const identity = {data:{principalId:randomUUID(),publicKey:pair.publicKey.export({type:'spki',format:'der'}).toString('base64url')},
    privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString()};
  (host as any).identity = async () => identity;
  }
  process.on('message', async (message: any) => {
    try {
      let value: unknown;
      if (message.op === 'claim') value = host.snapshot().claim;
      else if (message.op === 'access') value = await host.setComputerAppAccess('ai.xopc.input-benchmark', true);
      else if (message.op === 'status') { const {claim: _claim,...snapshot}=host.snapshot(); value = { ...snapshot, captureStats: (host.broker as any).driver.getCaptureStats(), identityStorage: process.env.XOPC_PAIR_EPHEMERAL_IDENTITY === '1' ? 'ephemeral-memory' : 'os-keychain' }; }
      else if (message.op === 'stop') { await host.close(); window.destroy(); process.send?.({ id: message.id, value: true }, () => app.exit(0)); return; }
      else throw new Error('Unknown operation');
      process.send?.({ id: message.id, value });
    } catch (error) { process.send?.({ id: message.id, error: error instanceof Error && /^COMPUTER_[A-Z_]+$/.test(error.message) ? error.message : 'PAIR_DESKTOP_FAILED' }); }
  });
  console.error('PAIR_DESKTOP_START_HOST');
  await host.start(); console.error('PAIR_DESKTOP_HOST_STARTED'); process.send?.({ ready: true });
}
void main().catch(() => app.exit(1));
