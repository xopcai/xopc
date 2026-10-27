import { createHash, createPrivateKey, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import { join } from 'node:path';

import { Adb, AdbDaemonTransport, AdbPacket, AdbPacketSerializeStream, AdbSignatureAuthenticator } from '@yume-chan/adb';
import { Consumable, ReadableStream, StructDeserializeStream } from '@yume-chan/stream-extra';

import { resolveCredentialsDir } from '../config/paths.js';
import { parsePhoneApplications, phoneApplicationsCommand } from './applications.js';
import { observeAdbConsumption } from './cloud-adb-writable.js';
import { readScrcpyServer } from './scrcpy-assets.js';
import { PhoneError } from './contracts.js';
import { protectPhoneCredential } from './cloud-key-permissions.js';
import { measurePhonePhase } from './execution-trace.js';
import { PhoneUiSession } from './ui-session.js';
import { PHONE_UI_DEX } from './ui-dump-binary.js';

/** Accept only an explicit TCP endpoint, never URLs, paths or ADB commands. */
export function parseCloudEndpoint(value: string): { host: string; port: number; endpoint: string } {
  const match = /^(\[[a-fA-F0-9:]+\]|[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?):([0-9]{1,5})$/.exec(value.trim());
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) throw new PhoneError('PHONE_ENDPOINT_INVALID', 'Enter the cloud ADB address as host:port');
  return { host: match[1].replace(/^\[|\]$/g, ''), port: Number(match[2]), endpoint: `${match[1].toLowerCase()}:${Number(match[2])}` };
}
export function parseCloudPrivateKey(pem: string): Buffer {
  try {
    if (Buffer.byteLength(pem) > 16_384) throw new Error();
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength !== 2048 || key.asymmetricKeyDetails?.publicExponent !== 65537n) throw new Error();
    return key.export({ format: 'der', type: 'pkcs8' });
  } catch { throw new PhoneError('PHONE_KEY_INVALID', 'Upload the unencrypted RSA 2048 private adbkey downloaded from the cloud console'); }
}

export class PhoneCloudKeyStore {
  constructor(private root = join(resolveCredentialsDir(), 'phone-adb')) {}
  private path(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new PhoneError('PHONE_KEY_INVALID', 'Invalid phone credential reference');
    return join(this.root, `${id}.der`);
  }
  async save(key: Buffer): Promise<string> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await protectPhoneCredential(this.root, true);
    const id = randomUUID(); const path = this.path(id);
    await writeFile(path, key, { mode: 0o600, flag: 'wx' });
    try { await protectPhoneCredential(path, false); return id; }
    catch (error) { await rm(path, { force: true }); throw error; }
  }
  async load(id: string): Promise<Buffer> {
    try {
      const path = this.path(id);
      await lstat(path);
      await protectPhoneCredential(this.root, true); await protectPhoneCredential(path, false);
      return await readFile(path);
    } catch (error) {
      if (error instanceof PhoneError && error.code === 'PHONE_KEY_PERMISSIONS') throw error;
      throw new PhoneError('PHONE_KEY_MISSING', 'Phone private key is unavailable. Remove this connection and add it again.');
    }
  }
  async remove(id: string): Promise<void> { await rm(this.path(id), { force: true }); }
}

/** Direct daemon transport never starts or modifies the host ADB server. */
export class CloudAdbConnection {
  private socket?: Socket;
  private adb?: Adb;
  private pending?: Promise<Adb>;
  private idle?: ReturnType<typeof setTimeout>;
  constructor(readonly endpoint: string, protected key: Buffer) { parseCloudEndpoint(endpoint); }
  close(): void {
    clearTimeout(this.idle); this.socket?.destroy(); this.socket = undefined; this.adb = undefined;
  }
  dispose(): void { this.close(); this.key.fill(0); }
  /** A dedicated media connection can multiplex sync, video and control sockets. */
  async client(): Promise<Adb> {
    if (this.adb) return this.adb;
    if (this.pending) return this.pending;
    const opening = this.open(); this.pending = opening;
    try { return await opening; } finally { if (this.pending === opening) this.pending = undefined; }
  }
  private async open(): Promise<Adb> {
    const { host, port } = parseCloudEndpoint(this.endpoint);
    const socket = connect({ host, port }); this.socket = socket; socket.setNoDelay(true);
    // Keep a permanent error listener: late errors after cancellation must not crash Gateway.
    socket.on('error', () => {});
    try {
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); socket.once('close', () => reject(new Error('closed'))); });
      const iterator = socket[Symbol.asyncIterator]();
      const raw = new ReadableStream<Uint8Array>({
        async pull(controller) { const next = await iterator.next(); if (next.done) controller.close(); else controller.enqueue(next.value); },
        cancel() { socket.destroy(); },
      });
      const serializer = new AdbPacketSerializeStream();
      // Observe pipe termination immediately, including cancellation before close().
      void serializer.readable.pipeTo(new Consumable.WritableStream<Uint8Array>({
        write(chunk) { return new Promise<void>((resolve, reject) => socket.write(chunk, error => error ? reject(error) : resolve())); },
        close() { socket.destroy(); }, abort() { socket.destroy(); },
      })).catch(() => { socket.destroy(); });
      const key = this.key;
      const transport = await AdbDaemonTransport.authenticate({ serial: this.endpoint,
        connection: { readable: raw.pipeThrough(new StructDeserializeStream(AdbPacket)), writable: observeAdbConsumption(serializer.writable) },
        credentialStore: { *iterateKeys() { yield { buffer: key, name: 'xopc-cloud-phone' }; }, generateKey() { throw new Error('Key generation disabled'); } },
        authenticators: [AdbSignatureAuthenticator],
      });
      if (socket.destroyed) { await transport.close(); throw new Error('closed'); }
      const adb = new Adb(transport); this.adb = adb;
      void adb.disconnected.catch(() => {}).finally(() => { if (this.adb === adb) this.close(); });
      return adb;
    } catch { socket.destroy(); throw new PhoneError('PHONE_CLOUD_AUTH_FAILED', 'Cloud ADB connection failed. Check address, network access and the bound private key.', 502); }
  }
  async command(_path: string, args: string[], signal?: AbortSignal, timeout = 15_000): Promise<Buffer> {
    const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeout)]);
    combined.throwIfAborted();
    let abort: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => { this.close(); reject(new PhoneError('PHONE_CLOUD_TIMEOUT', 'Cloud phone connection stopped or timed out. Check its ADB address and network.', 502)); };
      combined.addEventListener('abort', abort, { once: true });
    });
    try {
      return await Promise.race([cancelled, (async () => {
        const adb = await this.client();
        if (args[0] === 'devices') return Buffer.from(`List of devices attached\n${this.endpoint}\tdevice model:${adb.banner.model ?? 'Cloud_Phone'}\n`);
        if (args[0] !== '-s' || args[1] !== this.endpoint || !['shell', 'exec-out'].includes(args[2])) throw new PhoneError('PHONE_CLOUD_COMMAND_INVALID', 'Unsupported cloud ADB command');
        const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
        const channel = await adb.createSocket(`${args[2] === 'exec-out' ? 'exec' : 'shell'}:${args.slice(3).map(quote).join(' ')}`);
        const chunks: Buffer[] = []; let length = 0;
        try {
          for await (const chunk of channel.readable) {
            length += chunk.length; if (length > 16 * 1024 * 1024) throw new Error('Output exceeded'); chunks.push(Buffer.from(chunk));
          }
          return Buffer.concat(chunks);
        } finally { await channel.close(); }
      })()]);
    } catch (error) {
      this.close(); if (error instanceof PhoneError) throw error;
      throw new PhoneError('PHONE_CLOUD_ADB_FAILED', 'Cloud phone operation failed. Reconnect or run diagnostics.', 502);
    } finally {
      combined.removeEventListener('abort', abort!);
      clearTimeout(this.idle); this.idle = setTimeout(() => this.close(), 30_000); this.idle.unref();
    }
  }
  private async prepareUi(signal: AbortSignal): Promise<string> {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
    const abort = () => this.close(); combined.addEventListener('abort', abort, { once: true });
    const binary = Buffer.from(PHONE_UI_DEX, 'base64');
    const hash = createHash('sha256').update(binary).digest('hex');
    const remote = `/data/local/tmp/xopc-ui-${hash}.dex`;
    let staging: string | undefined;
    try {
      combined.throwIfAborted();
      const existing = (await this.command('', ['-s', this.endpoint, 'shell', 'sha256sum', remote], combined)).toString().trim().split(/\s+/)[0];
      if (existing !== hash) {
        staging = `${remote}.${randomUUID()}.tmp`;
        await measurePhonePhase('dex_upload', async () => {
          const adb = await this.client(); combined.throwIfAborted();
          const sync = await adb.sync();
          try {
            await sync.write({ filename: staging!, permission: 0o600, file: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(binary); controller.close(); } }) });
          } finally { await sync.dispose(); }
          await this.command('', ['-s', this.endpoint, 'shell', 'chmod', '400', staging!], combined);
          await this.command('', ['-s', this.endpoint, 'shell', 'mv', '-f', staging!, remote], combined);
          const deployed = (await this.command('', ['-s', this.endpoint, 'shell', 'sha256sum', remote], combined)).toString().trim().split(/\s+/)[0];
          if (deployed !== hash) throw new PhoneError('PHONE_UI_UNAVAILABLE', 'Phone UI helper verification failed', 502);
        });
      }
      return remote;
    } finally {
      combined.removeEventListener('abort', abort);
      if (staging) await this.command('', ['-s', this.endpoint, 'shell', 'rm', '-f', staging], undefined, 3000).catch(() => {});
    }
  }
  async hierarchy(signal: AbortSignal): Promise<string> {
    const remote = await this.prepareUi(signal);
    const result = (await this.command('', ['-s', this.endpoint, 'shell', 'env', `CLASSPATH=${remote}`, 'app_process', '/', 'ai.xopc.phone.PhoneUiDump'], signal)).toString();
    if (!result.includes('</hierarchy>')) throw new PhoneError('PHONE_UI_UNAVAILABLE', 'Incomplete phone hierarchy', 502);
    return result;
  }
  async observer(signal: AbortSignal): Promise<PhoneUiSession> {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
    const abort = () => this.close(); combined.addEventListener('abort', abort, { once: true });
    try {
      const remote = await this.prepareUi(combined);
      const adb = await this.client(); combined.throwIfAborted();
      const channel = await adb.createSocket(`exec:env CLASSPATH=${remote} app_process / ai.xopc.phone.PhoneUiDump --resident`);
      if (combined.aborted) { await channel.close(); combined.throwIfAborted(); }
      clearTimeout(this.idle);
      const writer = channel.writable.getWriter();
      void writer.closed.catch(() => {});
      return new PhoneUiSession({ readable: channel.readable,
        write: data => writer.write(data),
        close: async () => { await channel.close(); writer.releaseLock(); },
      });
    } finally { combined.removeEventListener('abort', abort); }
  }
  async applications(signal: AbortSignal) {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    const abort = () => this.close(); combined.addEventListener('abort', abort, { once: true });
    const remote = `/data/local/tmp/xopc-apps-${randomUUID()}.jar`;
    try {
      combined.throwIfAborted(); const binary = await readScrcpyServer(); const adb = await this.client();
      combined.throwIfAborted(); const sync = await adb.sync();
      try { await sync.write({ filename: remote, permission: 0o600, file: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(binary); controller.close(); } }) }); }
      finally { await sync.dispose(); }
      const raw = await this.command('', ['-s', this.endpoint, 'shell', ...phoneApplicationsCommand(remote)], combined);
      return parsePhoneApplications(raw.toString());
    } finally {
      combined.removeEventListener('abort', abort);
      await this.command('', ['-s', this.endpoint, 'shell', 'rm', '-f', remote], undefined, 3000).catch(() => {});
    }
  }
}
