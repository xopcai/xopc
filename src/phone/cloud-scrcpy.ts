import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { AdbSocket } from '@yume-chan/adb';
import { ReadableStream } from '@yume-chan/stream-extra';

import { CloudAdbConnection } from './cloud-adb.js';
import { PhoneError } from './contracts.js';
import { readScrcpyServer, SCRCPY_VERSION, ScrcpyProvider, ScrcpyVideoParser } from './scrcpy.js';

/** Dedicated authenticated ADB transport: no host ADB key, server or port forwarding. */
export class CloudScrcpyProvider extends ScrcpyProvider {
  private connection: CloudAdbConnection;
  private process?: AdbSocket;
  private video?: AdbSocket;
  private control?: AdbSocket;
  private writer?: ReturnType<AdbSocket['writable']['getWriter']>;
  private remote = '';
  private scid = '';
  constructor(private endpoint: string, key: Buffer, onFailure: () => void,
    connect = (address: string, credential: Buffer) => new CloudAdbConnection(address, credential)) {
    super(onFailure); this.connection = connect(endpoint, key);
  }
  foreground(signal: AbortSignal): Promise<string> { return this.connection.driver().foreground(this.endpoint, signal); }
  protected async startTransport(): Promise<void> {
    const timer = setTimeout(() => this.connection.close(), 20_000);
    try {
      const binary = await readScrcpyServer();
      const adb = await this.connection.client();
      if (this.closing) throw new Error('Video closed');
      this.scid = (randomBytes(4).readUInt32BE() & 0x7fffffff).toString(16);
      const socketName = `scrcpy_${this.scid.padStart(8, '0')}`;
      this.remote = `/data/local/tmp/xopc-${socketName}.jar`;
      const sync = await adb.sync();
      try {
        await sync.write({ filename: this.remote, permission: 0o600,
          file: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(binary); controller.close(); } }) });
      } finally { await sync.dispose(); }
      if (this.closing) throw new Error('Video closed');
      this.process = await adb.createSocket(`exec:CLASSPATH=${this.remote} app_process / com.genymobile.scrcpy.Server ${SCRCPY_VERSION} scid=${this.scid} tunnel_forward=true audio=false control=true cleanup=false max_size=960 max_fps=30 video_bit_rate=2000000 video_codec=h264 video_codec_options=i-frame-interval=1 send_dummy_byte=false send_device_meta=false send_codec_meta=true send_frame_meta=true clipboard_autosync=false`);
      void this.drain(this.process);
      for (let attempt = 0; attempt < 60; attempt++) {
        if (this.closing) throw new Error('Video closed');
        try { this.video = await adb.createSocket(`localabstract:${socketName}`); break; }
        catch { await delay(50); }
      }
      if (!this.video) throw new Error('Scrcpy connection timed out');
      this.control = await adb.createSocket(`localabstract:${socketName}`);
      this.writer = this.control.writable.getWriter();
      void this.drain(this.control);
      void this.readVideo(this.video);
    } finally { clearTimeout(timer); }
  }
  private async drain(socket: AdbSocket): Promise<void> {
    try { for await (const _chunk of socket.readable) { /* No clipboard or process output is retained. */ } }
    catch { /* Transport termination is handled identically to EOF. */ }
    if (!this.closing) this.fail();
  }
  private async readVideo(socket: AdbSocket): Promise<void> {
    const parser = new ScrcpyVideoParser();
    try { for await (const chunk of socket.readable) parser.push(Buffer.from(chunk), packet => this.packet(packet)); }
    catch { /* EOF and malformed packets both fail closed. */ }
    if (!this.closing) this.fail();
  }
  protected async write(buffer: Buffer): Promise<void> {
    if (!this.writer) throw new PhoneError('PHONE_INPUT_DISCONNECTED', 'Cloud phone input channel unavailable');
    // A stalled cloud socket must not keep control handback pending indefinitely.
    const timer = setTimeout(() => this.connection.close(), 2000);
    try { await this.writer.write(buffer); }
    finally { clearTimeout(timer); }
  }
  protected async cleanup(): Promise<void> {
    try {
      await this.revoke().catch(() => {});
      this.writer?.releaseLock(); this.writer = undefined;
      await Promise.allSettled([this.video?.close(), this.control?.close(), this.process?.close()]);
      if (this.scid) {
        const command = (...args: string[]) => this.connection.command('', ['-s', this.endpoint, 'shell', ...args], undefined, 3000);
        const processes = await command('ps', '-A', '-o', 'PID,ARGS').catch(() => Buffer.alloc(0));
        for (const line of processes.toString().split('\n')) {
          const pid = /^\s*(\d+)\s+/.exec(line)?.[1];
          if (pid && line.includes('com.genymobile.scrcpy.Server ') && new RegExp(`(?:^|\\s)scid=${this.scid}(?:\\s|$)`).test(line))
            await command('kill', '-TERM', pid).catch(() => {});
        }
        if (this.remote) await command('rm', '-f', this.remote).catch(() => {});
      }
    } finally { this.connection.dispose(); }
  }
}
