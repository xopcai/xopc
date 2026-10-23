import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhoneInteractiveSession } from '../interactive-session.js';
import { ScrcpyVideoParser, scrcpyTouch } from '../scrcpy.js';
import { PhoneError } from '../contracts.js';
import type { PhoneInteractiveProvider, PhonePointer, PhoneVideoPacket } from '../live-provider.js';

const streams: PhoneInteractiveSession[] = [];
afterEach(async () => { for (const stream of streams.splice(0)) await stream.close(); vi.useRealTimers(); });
const pointer = (phase: PhonePointer['phase'], seq: number): PhonePointer => ({ type: 'pointer', phase, seq, epoch: 2, geometry: 1, x: 500, y: 500 });
function fixture() {
  let emit!: (packet: PhoneVideoPacket) => void; let epoch = 2; let allowed = true;
  const provider: PhoneInteractiveProvider = { descriptor: { kind: 'scrcpy-h264', protocolVersion: 1, continuousTouch: true, maxPointers: 1 }, geometry: { width: 576, height: 1280, version: 1, codec: 'avc1.42c029' },
    foreground: vi.fn(async () => 'com.android.settings'), start: vi.fn(async () => {}), subscribe: fn => { emit = fn; return () => {}; }, refresh: vi.fn(), pointer: vi.fn(async () => {}), revoke: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const checkScreen = vi.fn(async () => { if (!allowed) throw new PhoneError('PHONE_APP_DENIED', 'Denied'); });
  const stream = new PhoneInteractiveSession(provider, checkScreen, (client, inputEpoch) => {
    if (client !== 'human' || inputEpoch !== epoch) throw new PhoneError('PHONE_CONTROL_CHANGED', 'Changed');
  }); streams.push(stream);
  return { provider, stream, checkScreen, emit: (packet: PhoneVideoPacket) => emit(packet), changeEpoch: () => { epoch++; }, deny: () => { allowed = false; } };
}
describe('scrcpy pinned wire protocol', () => {
  it('parses fragmented and coalesced packets without dropping config/key flags', () => {
    const parser = new ScrcpyVideoParser(); const packets: PhoneVideoPacket[] = [];
    const meta = Buffer.alloc(12); meta.writeUInt32BE(0x68323634);
    const wire = (flag: bigint, data: string) => { const header = Buffer.alloc(12); header.writeBigUInt64BE(flag | 42n); header.writeUInt32BE(data.length, 8); return Buffer.concat([header, Buffer.from(data)]); };
    const data = Buffer.concat([meta, wire(1n << 63n, 'config'), wire(1n << 62n, 'IDR'), wire(0n, 'delta')]);
    for (let i = 0; i < data.length; i += 3) parser.push(data.subarray(i, i + 3), packet => packets.push(packet));
    expect(packets.map(p => [p.config, p.key, p.pts, p.data.toString()])).toEqual([[true, false, 42, 'config'], [false, true, 42, 'IDR'], [false, false, 42, 'delta']]);
    const bad = Buffer.alloc(12); bad.writeUInt32BE(5_000_000, 8); expect(() => parser.push(bad, () => {})).toThrow();
  });
  it('encodes real down/move/up/cancel and scaled video geometry', () => {
    const down = scrcpyTouch('down', 500, 1000, 576, 1280);
    expect(down.length).toBe(32); expect(down[0]).toBe(2); expect(down[1]).toBe(0);
    expect(down.readInt32BE(10)).toBe(288); expect(down.readInt32BE(14)).toBe(1279);
    expect(down.readUInt16BE(18)).toBe(576); expect(down.readUInt16BE(22)).toBe(65535);
    expect(scrcpyTouch('move', 0, 0, 10, 20)[1]).toBe(2);
    expect(scrcpyTouch('up', 0, 0, 10, 20).readUInt16BE(22)).toBe(0);
    expect(scrcpyTouch('cancel', 0, 0, 10, 20)[1]).toBe(3);
  });
});
it('keeps viewing separate from the exclusive input lease and rejects replay', async () => {
  const { stream, provider } = fixture(); await stream.start();
  expect(() => stream.input('viewer', pointer('down', 1))).toThrow('Changed');
  await stream.input('human', pointer('down', 1)); await stream.input('human', pointer('move', 2)); await stream.input('human', pointer('up', 3));
  expect(provider.pointer).toHaveBeenCalledTimes(3);
  expect(() => stream.input('human', pointer('up', 3))).toThrow('Stale');
  expect(() => stream.authorizeClient('viewer', 2)).toThrow('Changed');
});
it('fences queued old-epoch moves before revocation and orders new input after cancel', async () => {
  const { stream, provider, changeEpoch } = fixture(); await stream.start();
  let complete!: () => void;
  vi.mocked(provider.pointer).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const down = stream.input('human', pointer('down', 1)); await vi.waitFor(() => expect(provider.pointer).toHaveBeenCalledTimes(1));
  const move = stream.input('human', pointer('move', 2)); const rejected = expect(move).rejects.toThrow('Changed');
  changeEpoch(); const revoke = stream.revoke(); expect(provider.revoke).not.toHaveBeenCalled();
  complete(); await down; await rejected; await revoke;
  expect(provider.pointer).toHaveBeenCalledTimes(1); expect(provider.revoke).toHaveBeenCalledTimes(1);
});
it('waits for delayed cloud foreground verification and fences an intervening handback', async () => {
  vi.useFakeTimers();
  const { stream, provider, checkScreen, changeEpoch } = fixture(); await stream.start();
  let finish!: () => void;
  checkScreen.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  await vi.advanceTimersByTimeAsync(350);
  const input = stream.input('human', pointer('down', 1));
  const rejected = expect(input).rejects.toThrow('Changed');
  await Promise.resolve(); expect(provider.pointer).not.toHaveBeenCalled();
  changeEpoch(); finish(); await rejected;
  expect(provider.pointer).not.toHaveBeenCalled();
});
it('gates video after foreground verification, hides refused pixels and waits for a key frame', async () => {
  vi.useFakeTimers(); const { stream, emit, deny, provider } = fixture();
  await stream.start(); const packet = vi.fn(); const fault = vi.fn(); stream.subscribe('viewer', packet, fault);
  const frame = (key: boolean): PhoneVideoPacket => ({ data: Buffer.from('pixels'), key, config: false, pts: 1 });
  emit(frame(false)); await vi.advanceTimersByTimeAsync(40); expect(packet).not.toHaveBeenCalled();
  emit(frame(true)); await vi.advanceTimersByTimeAsync(40); expect(packet).toHaveBeenCalledTimes(1);
  deny(); emit(frame(true)); await vi.advanceTimersByTimeAsync(40);
  expect(packet).toHaveBeenCalledTimes(1); expect(fault).toHaveBeenCalledWith('PHONE_APP_DENIED'); expect(provider.revoke).toHaveBeenCalled();
});
