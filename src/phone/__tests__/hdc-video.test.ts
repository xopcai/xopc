import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import { expect, it, vi } from 'vitest';

import { PhoneError, PhoneConfigSchema, type PhoneObservation } from '../contracts.js';
import type { PhoneDriver } from '../adb-driver.js';
import type { HdcPhoneDriver } from '../hdc-driver.js';
import { HdcBridgeParser, HdcVideoParser, HdcVideoProvider } from '../hdc-video.js';
import type { PhonePointer, PhoneVideoPacket } from '../live-provider.js';

const config = Buffer.from('000000016764000aacd9471be797011000000300100000030020f12259600000000168ebe3cb22c0', 'hex');
const key = Buffer.from('00000001650102', 'hex');
const envelope = (kind: number, data = Buffer.alloc(0)) => { const head = Buffer.alloc(5); head[0] = kind; head.writeUInt32BE(data.length, 1); return Buffer.concat([head, data]); };
const pointer = (phase: PhonePointer['phase'], extra: Partial<PhonePointer> = {}): PhonePointer => ({ type: 'pointer', phase, epoch: 2, seq: 1, geometry: 1, x: 500, y: 500, ...extra });
const screen = (): PhoneObservation => ({ platform: 'harmonyos', package: 'com.huawei.hmos.settings', width: 100, height: 200, rotation: 0,
  frame: Buffer.from('pixels'), frameId: 'frame', capturedAt: Date.now(), elements: [] });

it('frames partial/coalesced bridge messages and rejects corrupt or excessive envelopes', () => {
  const parser = new HdcBridgeParser(); const packets: number[] = [];
  const bytes = Buffer.concat([envelope(2), envelope(1, key), envelope(4)]);
  parser.push(bytes.subarray(0, 3), kind => packets.push(kind)); parser.push(bytes.subarray(3), kind => packets.push(kind));
  expect(packets).toEqual([2, 1, 4]);
  expect(() => new HdcBridgeParser().push(envelope(9), () => {})).toThrow();
  const large = envelope(1); large.writeUInt32BE(4 * 1024 * 1024 + 1, 1);
  expect(() => new HdcBridgeParser().push(large, () => {})).toThrow();
});

it('derives geometry and keyframe flags from Annex-B, including split SPS/PPS callbacks', () => {
  const parser = new HdcVideoParser(); const packets: PhoneVideoPacket[] = [];
  const ppsAt = config.indexOf(Buffer.from('0000000168', 'hex'));
  parser.push(config.subarray(0, ppsAt), packet => packets.push(packet)); expect(packets).toHaveLength(0);
  parser.push(config.subarray(ppsAt), packet => packets.push(packet)); parser.push(key, packet => packets.push(packet));
  expect(parser.geometry).toMatchObject({ width: 100, height: 200, version: 1 });
  expect(packets.map(packet => [packet.config, packet.key])).toEqual([[true, false], [false, true]]);
  parser.push(config, packet => packets.push(packet)); expect(packets).toHaveLength(2);
  expect(() => parser.push(Buffer.from('invalid'), () => {})).toThrow();
});

async function fixture(validateScreen?: (app: string) => void) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null as number | null, signalCode: null });
  const end = () => { if (child.exitCode === null) { child.exitCode = 0; child.emit('exit', 0); child.emit('close', 0); } };
  child.stdin.on('finish', end);
  const process = Object.assign(child, { kill: vi.fn(() => { end(); return true; }) });
  const driver = { observe: vi.fn(async () => screen()), execute: vi.fn<PhoneDriver['execute']>(async () => {}), foreground: vi.fn(async () => 'com.huawei.hmos.settings') };
  const command = vi.fn(async () => Buffer.from('[Empty]'));
  const cleanup = vi.fn(async () => {}); const spawn = vi.fn(() => process as unknown as ChildProcess);
  const failed = vi.fn();
  const provider = new HdcVideoProvider('PHONE', PhoneConfigSchema.parse({}), failed, {
    driver: driver as unknown as HdcPhoneDriver, tools: () => ({ java: 'java', javac: 'javac', jar: 'sdk.jar', classpath: 'sdk.jar' }),
    compile: async () => ({ program: 'java', args: [], cleanup }), spawn: spawn as never, command, validateScreen,
  });
  const start = provider.start(); await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
  const ready = () => { child.stdout.write(Buffer.concat([envelope(1, config), envelope(1, key)])); };
  return { provider, child, driver, command, cleanup, failed, start, ready };
}

it('executes only completed gestures and drops cancelled or revoked input without creating a tap', async () => {
  const f = await fixture(); f.ready(); await f.start;
  try {
    await f.provider.pointer(pointer('down')); await f.provider.pointer(pointer('cancel'));
    expect(f.driver.execute).not.toHaveBeenCalled();
    await f.provider.pointer(pointer('down')); await f.provider.revoke();
    await expect(f.provider.pointer(pointer('up'))).rejects.toMatchObject({ code: 'PHONE_POINTER_SEQUENCE' });
    expect(f.driver.execute).not.toHaveBeenCalled();
    await f.provider.pointer(pointer('down')); await f.provider.pointer(pointer('up', { durationMs: 120 }));
    expect(f.driver.execute).toHaveBeenCalledWith('PHONE', { type: 'tap', point: [500, 500] }, expect.anything(), expect.any(AbortSignal), { settleMs: 0 });
    await f.provider.pointer(pointer('down')); await f.provider.pointer(pointer('move', { y: 700 })); await f.provider.pointer(pointer('up', { y: 800, durationMs: 400 }));
    expect(f.driver.execute.mock.calls.at(-1)?.[1]).toEqual({ type: 'swipe', start: [500, 500], end: [500, 800], durationMs: 400 });
  } finally { await f.provider.close(); }
  expect(f.cleanup).toHaveBeenCalledOnce(); expect(f.failed).not.toHaveBeenCalled();
});

it('fences a pending observation and waits for already dispatched input before handing back', async () => {
  const f = await fixture(); f.ready(); await f.start;
  try {
    await f.provider.pointer(pointer('down'));
    let done!: () => void;
    f.driver.execute.mockImplementationOnce(() => new Promise<void>(resolve => { done = resolve; }));
    const up = f.provider.pointer(pointer('up', { durationMs: 120 })); await vi.waitFor(() => expect(done).toBeDefined());
    let revoked = false; const revocation = f.provider.revoke().then(() => { revoked = true; }); await Promise.resolve(); expect(revoked).toBe(false);
    done(); await up; await revocation; expect(revoked).toBe(true);
    let observed!: (screen: PhoneObservation) => void;
    f.driver.observe.mockImplementationOnce(() => new Promise(resolve => { observed = resolve; }));
    const down = f.provider.pointer(pointer('down')); const rejected = expect(down).rejects.toMatchObject({ code: 'PHONE_CONTROL_CHANGED' });
    await vi.waitFor(() => expect(observed).toBeDefined()); const revoke = f.provider.revoke(); observed(screen()); await rejected; await revoke;
    expect(f.driver.execute).toHaveBeenCalledOnce();
  } finally { await f.provider.close(); }
});

it('rejects stale geometry and a foreground change during a gesture', async () => {
  const f = await fixture(); f.ready(); await f.start;
  try {
    await expect(f.provider.pointer(pointer('down', { geometry: 2 }))).rejects.toMatchObject({ code: 'PHONE_GEOMETRY_CHANGED' });
    await f.provider.pointer(pointer('down'));
    f.driver.observe.mockResolvedValueOnce({ ...screen(), package: 'com.other.app' });
    await expect(f.provider.pointer(pointer('up'))).rejects.toMatchObject({ code: 'PHONE_FRAME_STALE' }); expect(f.driver.execute).not.toHaveBeenCalled();
  } finally { await f.provider.close(); }
});

it('reports an incompatible local SDK, cleans only its own forward metadata and retains unrelated connections', async () => {
  const f = await fixture();
  f.child.stderr.write('INFO [UitestServer] create uiTest socket success port:10001,10002,10003\n');
  const failed = expect(f.start).rejects.toMatchObject({ code: 'PHONE_HDC_VIDEO_DEPENDENCY' });
  f.child.stdout.write(envelope(4)); await failed;
  expect(f.command.mock.calls.filter(([, args]) => args.includes('rm')).map(([, args]) => args.slice(-2))).toEqual([
    ['tcp:10001', 'localabstract:uitest_socket'], ['tcp:10002', 'localabstract:uitest_socket'], ['tcp:10003', 'localabstract:uitest_socket'],
  ]);
  expect(f.cleanup).toHaveBeenCalledOnce();
});

it('finishes already dispatched native input before closing its transport', async () => {
  const f = await fixture(); f.ready(); await f.start;
  await f.provider.pointer(pointer('down'));
  let finish!: () => void; let nativeSignal!: AbortSignal;
  f.driver.execute.mockImplementationOnce(async (_serial, _action, _screen, signal) => { nativeSignal = signal; await new Promise<void>(resolve => { finish = resolve; }); });
  const input = f.provider.pointer(pointer('up', { durationMs: 120 }));
  await vi.waitFor(() => expect(finish).toBeDefined());
  let closed = false; const closing = f.provider.close().then(() => { closed = true; }); await Promise.resolve();
  expect(closed).toBe(false); expect(nativeSignal.aborted).toBe(false);
  finish(); await input; await closing; expect(nativeSignal.aborted).toBe(true); expect(closed).toBe(true);
});

it('refuses to take over a pre-existing native debugger connection', async () => {
  const compile = vi.fn(); const command = vi.fn(async () => Buffer.from('PHONE tcp:9000 localabstract:scrcpy_grpc_socket [Forward]'));
  const provider = new HdcVideoProvider('PHONE', PhoneConfigSchema.parse({}), vi.fn(), { tools: () => ({ java: 'java', javac: 'javac', jar: 'sdk.jar', classpath: 'sdk.jar' }), compile, command });
  await expect(provider.start()).rejects.toMatchObject({ code: 'PHONE_VIDEO_BUSY' });
  expect(compile).not.toHaveBeenCalled(); expect(command).toHaveBeenCalledOnce();
});

it('revalidates app authorization against the fresh native observation before dispatch', async () => {
  let allowed = true;
  const validate = vi.fn(() => { if (!allowed) throw new PhoneError('PHONE_APP_DENIED', 'Denied', 403); });
  const f = await fixture(validate); f.ready(); await f.start;
  try {
    await f.provider.pointer(pointer('down')); allowed = false;
    await expect(f.provider.pointer(pointer('up', { durationMs: 120 }))).rejects.toMatchObject({ code: 'PHONE_APP_DENIED' });
    expect(validate).toHaveBeenCalledTimes(2); expect(f.driver.execute).not.toHaveBeenCalled();
  } finally { await f.provider.close(); }
});
