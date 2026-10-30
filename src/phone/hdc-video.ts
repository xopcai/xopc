import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';

import { h264ParseConfiguration } from '@yume-chan/scrcpy';

import { runPhoneCommandBuffer, spawnPhoneInteractiveCommand } from '../process/phone-process.js';
import { HdcPhoneDriver, resolveHdcPath } from './hdc-driver.js';
import { PhoneError, type PhoneConfig, type PhoneObservation } from './contracts.js';
import type { PhoneInteractiveProvider, PhonePointer, PhoneVideoGeometry, PhoneVideoPacket } from './live-provider.js';
import { compileHdcVideoBridge, resolveHdcVideoTools } from './hdc-video-tools.js';

/** Each bridge callback carries one complete Annex-B encoded buffer. */
export class HdcVideoParser {
  geometry: PhoneVideoGeometry = { width: 0, height: 0, version: 0, codec: '' };
  private sps?: Buffer; private pps?: Buffer; private configuration?: Buffer;
  push(bytes: Buffer, emit: (packet: PhoneVideoPacket) => void): void {
    if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error('Invalid HarmonyOS video packet');
    const starts: Array<{ at: number; header: number }> = [];
    for (let index = 0; index + 3 < bytes.length; index++) {
      if (bytes[index] || bytes[index + 1]) continue;
      const length = bytes[index + 2] === 1 ? 3 : bytes[index + 2] === 0 && bytes[index + 3] === 1 ? 4 : 0;
      if (length) { if (starts.length >= 256) throw new Error('Too many HarmonyOS video NAL units'); starts.push({ at: index, header: index + length }); index += length - 1; }
    }
    if (!starts.length || starts[0].at !== 0) throw new Error('Expected Annex-B HarmonyOS video');
    let key = false; let frame = false;
    for (let index = 0; index < starts.length; index++) {
      const start = starts[index]; const type = bytes[start.header] & 31;
      const nal = bytes.subarray(start.at, starts[index + 1]?.at ?? bytes.length);
      if ((type === 7 || type === 8) && nal.length > 65536) throw new Error('Oversized HarmonyOS codec configuration');
      if (type === 7) this.sps = Buffer.from(nal);
      if (type === 8) this.pps = Buffer.from(nal);
      if (type === 5) key = true;
      if (type === 1 || type === 5) frame = true;
    }
    const pts = Number(process.hrtime.bigint() / 1000n);
    if (this.sps && this.pps) {
      const config = Buffer.concat([this.sps, this.pps]);
      if (!this.configuration?.equals(config)) {
        const parsed = h264ParseConfiguration(config);
        if (!parsed.croppedWidth || !parsed.croppedHeight || parsed.croppedWidth * parsed.croppedHeight > 16_000_000) throw new Error('Invalid HarmonyOS video geometry');
        this.configuration = config;
        this.geometry = { width: parsed.croppedWidth, height: parsed.croppedHeight, version: this.geometry.version + 1,
          codec: `avc1.${[parsed.profileIndex, parsed.constraintSet, parsed.levelIndex].map(value => value.toString(16).padStart(2, '0')).join('')}` };
        emit({ data: config, config: true, key: false, pts, geometry: this.geometry });
      }
    }
    if (frame && this.configuration) emit({ data: Buffer.from(bytes), config: false, key, pts, geometry: this.geometry });
  }
}

/** Binary pipe framing prevents vendor logs or partial writes from becoming video. */
export class HdcBridgeParser {
  private buffer = Buffer.alloc(0);
  push(bytes: Buffer, emit: (kind: number, bytes: Buffer) => void): void {
    if (this.buffer.length + bytes.length > 8 * 1024 * 1024) throw new Error('HarmonyOS bridge exceeded buffer limit');
    this.buffer = Buffer.concat([this.buffer, bytes]);
    while (this.buffer.length >= 5) {
      const kind = this.buffer[0]; const size = this.buffer.readUInt32BE(1);
      if (![1, 2, 3, 4].includes(kind) || size > 4 * 1024 * 1024 || kind !== 1 && size !== 0) throw new Error('Invalid HarmonyOS bridge envelope');
      if (this.buffer.length < size + 5) return;
      const packet = Buffer.from(this.buffer.subarray(5, size + 5)); this.buffer = this.buffer.subarray(size + 5);
      emit(kind, packet);
    }
  }
}

type Bridge = Awaited<ReturnType<typeof compileHdcVideoBridge>>;
type Dependencies = { driver?: HdcPhoneDriver; compile?: typeof compileHdcVideoBridge; spawn?: typeof spawnPhoneInteractiveCommand;
  command?: typeof runPhoneCommandBuffer; tools?: typeof resolveHdcVideoTools; validateScreen?: (app: string) => void };

/** H.264 video with completed-gesture input: cancellation never creates a tap. */
export class HdcVideoProvider implements PhoneInteractiveProvider {
  readonly descriptor = { kind: 'hdc-h264', protocolVersion: 1, continuousTouch: false, maxPointers: 1 } as const;
  private parser = new HdcVideoParser();
  get geometry() { return this.parser.geometry; }
  private driver: HdcPhoneDriver;
  private listeners = new Set<(packet: PhoneVideoPacket) => void>();
  private config?: PhoneVideoPacket;
  private process?: ChildProcess;
  private bridge?: Bridge;
  private controller = new AbortController(); private inputController = new AbortController();
  private opening?: Promise<void>; private started?: Promise<void>; private closing?: Promise<void>;
  private closed = false; private input: Promise<unknown> = Promise.resolve(); private inputEpoch = 0;
  private gesture?: { x: number; y: number; at: number; geometry: number; screen: Pick<PhoneObservation, 'package' | 'width' | 'height' | 'rotation'> };
  private forwards = new Set<string>(); private ownedForwards = new Set<string>();
  private path: string;
  constructor(private serial: string, private configOptions: PhoneConfig, private onFailure: () => void, private deps: Dependencies = {}) {
    this.path = resolveHdcPath(configOptions.hdcPath); this.driver = deps.driver ?? new HdcPhoneDriver(this.path);
  }
  foreground(signal: AbortSignal): Promise<string> {
    if (this.closed) return Promise.reject(new PhoneError('PHONE_VIDEO_ENDED', 'HarmonyOS video ended', 409));
    return this.driver.foreground(this.serial, signal);
  }
  private async listForwards(): Promise<Set<string>> {
    const raw = (await (this.deps.command ?? runPhoneCommandBuffer)(this.path, ['fport', 'ls'], AbortSignal.timeout(3000))).toString();
    return new Set(raw.split(/\r?\n/).flatMap(line => {
      const parts = line.trim().split(/\s+/);
      return parts[0] === this.serial && /^tcp:\d+$/.test(parts[1] ?? '') && /^localabstract:(?:uitest_socket|scrcpy_grpc_socket)/.test(parts[2] ?? '') ? [`${parts[1]} ${parts[2]}`] : [];
    }));
  }
  start(): Promise<void> {
    if (this.closed) return Promise.reject(new PhoneError('PHONE_VIDEO_ENDED', 'HarmonyOS video ended', 409));
    if (!this.started) {
      this.opening = this.open();
      this.started = this.opening.catch(async error => { await this.close(); throw error; });
    }
    return this.started;
  }
  private async open(): Promise<void> {
    const tools = (this.deps.tools ?? resolveHdcVideoTools)(this.configOptions);
    if (!tools) throw new PhoneError('PHONE_HDC_VIDEO_DEPENDENCY', 'Install DevEco Studio with HOScrcpy and a JDK on the Gateway host, or configure phone.hdcVideo.', 409);
    this.forwards = await this.listForwards();
    if (this.forwards.size) throw new PhoneError('PHONE_VIDEO_BUSY', 'Another HarmonyOS debugging or mirroring connection is active. Close it before opening video.', 409);
    const deadline = AbortSignal.any([this.controller.signal, AbortSignal.timeout(35_000)]);
    this.bridge = await (this.deps.compile ?? compileHdcVideoBridge)(tools, deadline);
    deadline.throwIfAborted();
    const child: ChildProcess = this.process = (this.deps.spawn ?? spawnPhoneInteractiveCommand)(this.bridge.program, [...this.bridge.args, this.serial, this.path, tools.jar], true);
    // Record only the SDK's own forward allocation metadata; discard all other diagnostics.
    let line = '';
    child.stderr?.on('data', chunk => {
      line = (line + chunk.toString()).slice(-4096);
      const lines = line.split(/\r?\n/); line = lines.pop() ?? '';
      for (const text of lines) {
        const ports = /\[UitestServer\] create uiTest socket success port:(\d+),(\d+),(\d+)\s*$/.exec(text);
        if (ports) for (const port of ports.slice(1)) this.ownedForwards.add(`tcp:${port} localabstract:uitest_socket`);
      }
    });
    child.stdin?.on('error', () => {});
    const wire = new HdcBridgeParser();
    await new Promise<void>((resolve, reject) => {
      let ready = false; let failed = false;
      const fail = (code = 'PHONE_HDC_VIDEO_FAILED') => { if (failed || this.closed) return; failed = true; if (ready) { this.onFailure(); void this.close(); } else reject(new PhoneError(code, code === 'PHONE_HDC_VIDEO_DEPENDENCY' ? 'The HOScrcpy library contains invalid class entries. Configure a complete compatible library in phone.hdcVideo.sdkJar.' : 'HarmonyOS video could not start. Check DevEco/HOScrcpy compatibility and the USB connection.', 502)); };
      const aborted = () => { child.kill(); reject(new PhoneError('PHONE_HDC_VIDEO_TIMEOUT', 'HarmonyOS video startup stopped or timed out', 502)); };
      deadline.addEventListener('abort', aborted, { once: true });
      child.once('error', () => fail()); child.once('exit', () => fail());
      child.stdout?.on('data', bytes => {
        try {
          wire.push(Buffer.from(bytes), (kind, data) => {
            if (kind === 4) { fail('PHONE_HDC_VIDEO_DEPENDENCY'); return; }
            if (kind === 3) { fail(); return; }
            if (kind !== 1 || this.closed) return;
            this.parser.push(data, packet => {
              if (packet.config) { this.config = packet; this.gesture = undefined; this.inputEpoch++; }
              for (const listener of this.listeners) listener(packet);
              if (packet.key && !ready) { ready = true; deadline.removeEventListener('abort', aborted); resolve(); }
            });
          });
        } catch { fail(); child.kill(); }
      });
    });
  }
  subscribe(listener: (packet: PhoneVideoPacket) => void): () => void {
    this.listeners.add(listener); if (this.config) listener(this.config);
    return () => this.listeners.delete(listener);
  }
  refresh(): void { if (this.config) for (const listener of this.listeners) listener(this.config); }
  pointer(pointer: PhonePointer): Promise<void> {
    const epoch = this.inputEpoch;
    const work = this.input.catch(() => {}).then(async () => {
      if (this.closed || epoch !== this.inputEpoch) throw new PhoneError('PHONE_CONTROL_CHANGED', 'HarmonyOS input was revoked', 409);
      const signal = AbortSignal.any([this.inputController.signal, AbortSignal.timeout(15_000)]);
      if (!this.geometry.version || pointer.geometry !== this.geometry.version) throw new PhoneError('PHONE_GEOMETRY_CHANGED', 'HarmonyOS screen geometry changed', 409);
      if (pointer.phase === 'cancel') { this.gesture = undefined; return; }
      if (pointer.phase === 'down') {
        if (this.gesture) throw new PhoneError('PHONE_POINTER_SEQUENCE', 'A HarmonyOS gesture is already pending', 409);
        const screen = await this.driver.observe(this.serial, signal); screen.frame.fill(0);
        this.deps.validateScreen?.(screen.package);
        if (this.closed || epoch !== this.inputEpoch || pointer.geometry !== this.geometry.version) throw new PhoneError('PHONE_CONTROL_CHANGED', 'HarmonyOS control changed while observing', 409);
        const videoRatio = this.geometry.width / this.geometry.height;
        if (Math.abs(screen.width / screen.height - videoRatio) > 0.015) throw new PhoneError('PHONE_GEOMETRY_CHANGED', 'Wait for the rotated HarmonyOS video frame', 409);
        this.gesture = { x: pointer.x, y: pointer.y, at: Date.now(), geometry: pointer.geometry, screen: { package: screen.package, width: screen.width, height: screen.height, rotation: screen.rotation } };
        return;
      }
      const gesture = this.gesture;
      if (!gesture) throw new PhoneError('PHONE_POINTER_SEQUENCE', 'Start a new HarmonyOS gesture', 409);
      if (pointer.phase === 'move') return;
      this.gesture = undefined;
      const fresh = await this.driver.observe(this.serial, signal);
      try {
        if (this.closed || epoch !== this.inputEpoch || gesture.geometry !== this.geometry.version) throw new PhoneError('PHONE_CONTROL_CHANGED', 'HarmonyOS gesture was revoked', 409);
        if (fresh.package !== gesture.screen.package || fresh.rotation !== gesture.screen.rotation || fresh.width !== gesture.screen.width || fresh.height !== gesture.screen.height)
          throw new PhoneError('PHONE_FRAME_STALE', 'HarmonyOS app or orientation changed during the gesture', 409);
        this.deps.validateScreen?.(fresh.package);
        const elapsed = Math.min(2000, Math.max(100, pointer.durationMs ?? Date.now() - gesture.at));
        const distance = Math.hypot(pointer.x - gesture.x, pointer.y - gesture.y);
        await this.driver.execute(this.serial, distance > 18
          ? { type: 'swipe', start: [gesture.x, gesture.y], end: [pointer.x, pointer.y], durationMs: elapsed }
          : elapsed > 600 ? { type: 'longPress', point: [pointer.x, pointer.y], durationMs: elapsed }
            : { type: 'tap', point: [pointer.x, pointer.y] }, fresh, signal, { settleMs: 0 });
      } finally { fresh.frame.fill(0); }
    });
    this.input = work; return work;
  }
  async revoke(): Promise<void> {
    this.inputEpoch++; this.gesture = undefined;
    await this.input.catch(() => {});
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; this.controller.abort();
    return this.closing = (async () => {
      await this.opening?.catch(() => {}); await this.revoke(); this.inputController.abort();
      const child = this.process;
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'close').catch(() => {});
        child.stdin?.end();
        const kill = setTimeout(() => child.kill('SIGKILL'), 4500);
        await exited; clearTimeout(kill);
      }
      // Never remove forwards that existed before this bridge started.
      if (this.bridge) {
        for (const item of this.ownedForwards) if (!this.forwards.has(item)) {
          await (this.deps.command ?? runPhoneCommandBuffer)(this.path, ['-t', this.serial, 'fport', 'rm', ...item.split(' ')], AbortSignal.timeout(3000)).catch(() => {});
        }
      }
      await this.bridge?.cleanup(); this.listeners.clear(); this.config = undefined; this.gesture = undefined;
    })();
  }
}
