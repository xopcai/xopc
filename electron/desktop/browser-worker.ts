import { app } from 'electron';
import { execFileSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import { REMOTE_BROWSER_INPUT_SCHEMA } from '@xopcai/browser-control-contract/remote';

import { DesktopBrowserWindowBroker } from './browser-window-broker.js';

/** Private Electron process entry, with no Gateway/renderer channel and no shared application state. */
export async function startDesktopBrowserWorker(): Promise<void> {
  const generation = process.env['XOPC_PRIVATE_BROWSER_GENERATION'], parentPid = Number(process.env['XOPC_PRIVATE_BROWSER_PARENT']);
  const userData = process.env['XOPC_PRIVATE_BROWSER_USER_DATA'];
  const expiresAt = Number(process.env['XOPC_PRIVATE_BROWSER_EXPIRES_AT']);
  if (process.platform !== 'darwin' || !process.send || !generation || !/^[a-f0-9-]{36}$/.test(generation) || !userData || !Number.isSafeInteger(parentPid) || parentPid < 2) throw new Error('DESKTOP_BROWSER_WORKER_IDENTITY_INVALID');
  if (Number(execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8', timeout: 1000 }).trim()) !== process.pid) throw new Error('DESKTOP_BROWSER_WORKER_GROUP_INVALID');
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 120000) throw new Error('DESKTOP_BROWSER_AUTHORITY_INVALID');
  app.setPath('userData', userData);
  app.setName('xopc Device Browser');
  app.commandLine.appendSwitch('disable-extensions');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-background-networking');
  const validate = new Ajv2020({ strict: true }).compile(REMOTE_BROWSER_INPUT_SCHEMA);
  let closed = false, active = false, initialized = false;
  const current = () => !closed && process.connected && Date.now() < expiresAt;
  const broker = new DesktopBrowserWindowBroker({ current });
  const terminate = () => {
    if (closed) return; closed = true;
    // This detached worker is its own process-group leader. Its descendants, including changing renderers,
    // share the private group; it never accepts a PID or signal target from a request.
    try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(1); }
  };
  process.once('disconnect', terminate);
  const expiry = setTimeout(terminate, Math.max(1, Math.min(120000, expiresAt - Date.now())));
  const watchdog = setInterval(() => {
    try { process.kill(parentPid, 0); } catch { terminate(); }
  }, 250);
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => { clearInterval(watchdog); clearTimeout(expiry); });
  await app.whenReady();
  process.on('message', async (message: any) => {
    if (message?.generation !== generation || !Number.isSafeInteger(message?.id) || message.id < 1 || !current()) return;
    const send = (value: unknown) => { if (process.connected) process.send!({ id: message.id, generation, ...value as object }); };
    if (message.command === 'stop') { await broker.dispose().catch(() => {}); send({ ok: true }); terminate(); return; }
    if (active) { send({ ok: false, error: 'DESKTOP_BROWSER_BUSY' }); return; }
    active = true;
    try {
      if (message.command === 'initialize' && !initialized) { initialized = true; send({ ok: true, value: { workerGroup: process.pid, generation } }); }
      else if (message.command === 'metadata' && initialized) send({ ok: true, value: broker.metadata() });
      else if (message.command === 'execute' && initialized && Buffer.byteLength(JSON.stringify(message.input)) <= 16384 && validate(message.input)) {
        const value = await broker.execute(message.input, AbortSignal.timeout(30000));
        const frame = value.frame;
        const copy = frame ? Buffer.from(frame.bytes) : undefined;
        try { send({ ok: true, value: { result: value.result, dispatch: value.dispatch,
          ...(frame ? { frame: { mimeType: frame.mimeType, bytesBase64: copy!.toString('base64') } } : {}) } }); }
        finally { copy?.fill(0); frame?.bytes.fill(0); }
      } else throw new Error('DESKTOP_BROWSER_COMMAND_DENIED');
    } catch (error) {
      console.error('[DesktopBrowser]', { name: error instanceof Error ? error.name : 'Unknown', frames: error instanceof Error ? error.stack?.split('\n').slice(1, 4) : [] });
      send({ ok: false, error: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'DESKTOP_BROWSER_WORKER_FAILED' });
    }
    finally { active = false; }
  });
  process.send({ id: 0, generation, ok: true, value: { ready: true } });
}
