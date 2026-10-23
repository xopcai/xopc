import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import { h264ParseConfiguration } from '@yume-chan/scrcpy';

import { managedScrcpyServerPath, SCRCPY_SHA256, SCRCPY_VERSION } from '../runtime-tools/phone-dependency-catalog.js';
import { AdbPhoneDriver, runAdb } from './adb-driver.js';
import { PhoneError } from './contracts.js';
import type { PhoneInteractiveProvider, PhonePointer, PhoneVideoGeometry, PhoneVideoPacket } from './live-provider.js';

export { SCRCPY_VERSION, SCRCPY_SHA256 };
export const scrcpyServerPath = managedScrcpyServerPath;

/** The pinned server sends codec metadata followed by bounded, length-prefixed packets. */
export class ScrcpyVideoParser {
  private buffer = Buffer.alloc(0);
  private metadata = false;
  push(chunk: Buffer, packet: (packet: PhoneVideoPacket) => void): void {
    if (chunk.length + this.buffer.length > 8 * 1024 * 1024) throw new Error('Scrcpy video buffer exceeded');
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.metadata) {
      if (this.buffer.length < 12) return;
      if (this.buffer.readUInt32BE(0) !== 0x68323634) throw new Error('Unsupported scrcpy codec');
      this.buffer = this.buffer.subarray(12); this.metadata = true;
    }
    while (this.buffer.length >= 12) {
      const size = this.buffer.readUInt32BE(8);
      if (!size || size > 4 * 1024 * 1024) throw new Error('Invalid scrcpy video packet');
      if (this.buffer.length < size + 12) return;
      const flags = this.buffer.readBigUInt64BE(0);
      packet({ data: Buffer.from(this.buffer.subarray(12, size + 12)), config: Boolean(flags & (1n << 63n)),
        key: Boolean(flags & (1n << 62n)), pts: Number(flags & ((1n << 62n) - 1n)) });
      this.buffer = this.buffer.subarray(size + 12);
    }
  }
}

export function scrcpyTouch(phase: PhonePointer['phase'], x: number, y: number, width: number, height: number): Buffer {
  const buffer = Buffer.alloc(32); buffer[0] = 2;
  buffer[1] = ({ down: 0, up: 1, move: 2, cancel: 3 })[phase];
  buffer.writeBigUInt64BE(0n, 2);
  buffer.writeInt32BE(Math.min(width - 1, Math.round(x * width / 1000)), 10);
  buffer.writeInt32BE(Math.min(height - 1, Math.round(y * height / 1000)), 14);
  buffer.writeUInt16BE(width, 18); buffer.writeUInt16BE(height, 20);
  buffer.writeUInt16BE(phase === 'up' || phase === 'cancel' ? 0 : 0xffff, 22);
  return buffer;
}

export async function readScrcpyServer(): Promise<Buffer> {
  const binary = await readFile(scrcpyServerPath()).catch(() => { throw new PhoneError('PHONE_VIDEO_SETUP_REQUIRED', 'Install scrcpy server in Settings → Phone Use → Dependencies'); });
  if (createHash('sha256').update(binary).digest('hex') !== SCRCPY_SHA256) throw new PhoneError('PHONE_VIDEO_HASH_MISMATCH', 'Phone video server checksum mismatch');
  return binary;
}

/** Local and cloud transports share geometry, gesture sequencing and revocation. */
export abstract class ScrcpyProvider implements PhoneInteractiveProvider {
  readonly descriptor = { kind: 'scrcpy-h264', protocolVersion: 1, continuousTouch: true, maxPointers: 1 } as const;
  geometry: PhoneVideoGeometry = { width: 0, height: 0, version: 0, codec: '' };
  protected closing = false;
  private touch?: { x: number; y: number };
  private listeners = new Set<(packet: PhoneVideoPacket) => void>();
  private config?: PhoneVideoPacket;
  private opening?: Promise<void>;
  private startResult?: Promise<void>;
  private closeResult?: Promise<void>;
  constructor(private onFailure: () => void) {}
  abstract foreground(signal: AbortSignal): Promise<string>;
  protected abstract startTransport(): Promise<void>;
  protected abstract write(buffer: Buffer): Promise<void>;
  protected abstract cleanup(): Promise<void>;
  start(): Promise<void> {
    if (this.closing) return Promise.reject(new PhoneError('PHONE_VIDEO_ENDED', 'Phone video ended', 409));
    if (!this.startResult) {
      this.opening = this.startTransport();
      this.startResult = this.opening.catch(async error => { await this.close(); throw error; });
    }
    return this.startResult;
  }
  protected packet(packet: PhoneVideoPacket): void {
    if (packet.config) {
      const info = h264ParseConfiguration(packet.data);
      this.geometry = { width: info.croppedWidth, height: info.croppedHeight, version: this.geometry.version + 1,
        codec: `avc1.${[info.profileIndex, info.constraintSet, info.levelIndex].map(value => value.toString(16).padStart(2, '0')).join('')}` };
      this.config = { ...packet, geometry: this.geometry };
      if (this.touch) void this.revoke().catch(() => this.fail());
    }
    for (const listener of this.listeners) listener({ ...packet, geometry: this.geometry });
  }
  subscribe(listener: (packet: PhoneVideoPacket) => void): () => void {
    this.listeners.add(listener); if (this.config) listener(this.config);
    // Encoder emits an IDR at most every second. Never replay stale P frames.
    return () => this.listeners.delete(listener);
  }
  async pointer(input: PhonePointer): Promise<void> {
    const { width, height, version } = this.geometry;
    if (!width || input.geometry !== version) throw new PhoneError('PHONE_GEOMETRY_CHANGED', 'Phone geometry changed; start a new gesture', 409);
    if (input.phase === 'down' ? Boolean(this.touch) : !this.touch) throw new PhoneError('PHONE_POINTER_SEQUENCE', 'Invalid pointer sequence', 409);
    await this.write(scrcpyTouch(input.phase, input.x, input.y, width, height));
    this.touch = input.phase === 'up' || input.phase === 'cancel' ? undefined : { x: input.x, y: input.y };
  }
  async revoke(): Promise<void> {
    if (!this.touch) return;
    const point = this.touch; this.touch = undefined;
    await this.write(scrcpyTouch('cancel', point.x, point.y, this.geometry.width, this.geometry.height));
  }
  protected fail(): void { if (this.closing) return; this.onFailure(); void this.close(); }
  refresh(): void { if (this.geometry.version) void this.write(Buffer.from([17])).catch(() => this.fail()); }
  close(): Promise<void> {
    this.closing = true;
    return this.closeResult ??= (async () => {
      await this.opening?.catch(() => {});
      try { await this.cleanup(); } finally { this.listeners.clear(); this.config = undefined; }
    })();
  }
}

export class LocalScrcpyProvider extends ScrcpyProvider {
  private process?: ChildProcess; private video?: Socket; private control?: Socket; private port?: string;
  private remote = ''; private scid = '';
  constructor(private adb: string, private serial: string, onFailure: () => void,
    private tuning = { maxSize: 960, bitRate: 2_000_000 }) { super(onFailure); }
  foreground(signal: AbortSignal): Promise<string> { return new AdbPhoneDriver(this.adb).foreground(this.serial, signal); }
  protected async startTransport(): Promise<void> {
    await readScrcpyServer();
    const scid = randomBytes(4).readUInt32BE() & 0x7fffffff;
    this.scid = scid.toString(16);
    const socketName = `scrcpy_${scid.toString(16).padStart(8, '0')}`;
    this.remote = `/data/local/tmp/xopc-scrcpy-${socketName}.jar`;
    try {
      await runAdb(this.adb, ['-s', this.serial, 'push', scrcpyServerPath(), this.remote]);
      if (this.closing) throw new Error('Video closed');
      this.port = (await runAdb(this.adb, ['-s', this.serial, 'forward', 'tcp:0', `localabstract:${socketName}`])).toString().trim();
      if (!/^\d+$/.test(this.port)) throw new Error('Invalid ADB forwarding port');
      if (this.closing) throw new Error('Video closed');
      this.process = spawn(this.adb, ['-s', this.serial, 'shell', `CLASSPATH=${this.remote}`, 'app_process', '/', 'com.genymobile.scrcpy.Server', SCRCPY_VERSION,
        `scid=${scid.toString(16)}`, 'tunnel_forward=true', 'audio=false', 'control=true', 'cleanup=false', `max_size=${this.tuning.maxSize}`,
        'max_fps=30', `video_bit_rate=${this.tuning.bitRate}`, 'video_codec=h264', 'video_codec_options=i-frame-interval=1',
        'send_dummy_byte=true', 'send_device_meta=false', 'send_codec_meta=true', 'send_frame_meta=true', 'clipboard_autosync=false'], { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
      this.process.once('error', () => this.fail()); this.process.once('exit', () => this.fail());
      // The first connection has a dummy byte; retry until Android is listening.
      for (let attempt = 0; attempt < 60; attempt++) {
        if (this.closing) throw new Error('Video closed');
        const socket = connect({ host: '127.0.0.1', port: Number(this.port) });
        const ready = await new Promise<boolean>(resolve => {
          const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 250);
          socket.once('error', () => { clearTimeout(timer); resolve(false); });
          socket.once('end', () => { clearTimeout(timer); resolve(false); });
          socket.once('data', data => { clearTimeout(timer); if (data.length !== 1 || data[0] !== 0) { socket.destroy(); resolve(false); } else resolve(true); });
        });
        if (ready) { this.video = socket; break; }
        socket.destroy(); await delay(50);
      }
      if (!this.video) throw new Error('Scrcpy connection timed out');
      const parser = new ScrcpyVideoParser();
      this.video.on('data', data => { try { parser.push(Buffer.from(data), packet => this.packet(packet)); } catch { this.fail(); } });
      this.video.on('error', () => this.fail()); this.video.on('end', () => this.fail());
      this.control = connect({ host: '127.0.0.1', port: Number(this.port) });
      this.control.setNoDelay(true); this.control.on('error', () => this.fail()); this.control.on('end', () => this.fail());
      // Drain device messages; clipboard synchronization is deliberately disabled.
      this.control.on('data', () => {});
      await new Promise<void>((resolve, reject) => { this.control!.once('connect', resolve); this.control!.once('error', reject); });
    } catch (error) { throw error; }
  }
  protected async write(buffer: Buffer): Promise<void> {
    if (!this.control || this.control.destroyed || this.control.writableLength > 64 * 1024) throw new PhoneError('PHONE_INPUT_DISCONNECTED', 'Phone input channel unavailable');
    await new Promise<void>((resolve, reject) => this.control!.write(buffer, error => error ? reject(error) : resolve()));
  }
  protected async cleanup(): Promise<void> {
    await this.revoke().catch(() => {});
    this.video?.destroy(); this.control?.destroy(); this.process?.kill();
    // Killing the host adb subprocess can leave app_process alive on Android.
    // Fence cleanup by our random scid; never stop another client's scrcpy server.
    if (this.scid) {
      const processes = await runAdb(this.adb, ['-s', this.serial, 'shell', 'ps', '-A', '-o', 'PID,ARGS']).catch(() => Buffer.alloc(0));
      for (const line of processes.toString().split('\n')) {
        const pid = /^\s*(\d+)\s+/.exec(line)?.[1];
        if (pid && line.includes('com.genymobile.scrcpy.Server ') && new RegExp(`(?:^|\\s)scid=${this.scid}(?:\\s|$)`).test(line))
          await runAdb(this.adb, ['-s', this.serial, 'shell', 'kill', '-TERM', pid]).catch(() => {});
      }
    }
    if (this.port) await runAdb(this.adb, ['-s', this.serial, 'forward', '--remove', `tcp:${this.port}`]).catch(() => {});
    if (this.remote) await runAdb(this.adb, ['-s', this.serial, 'shell', 'rm', '-f', this.remote]).catch(() => {});
  }
}
