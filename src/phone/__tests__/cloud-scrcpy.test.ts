import { ReadableStream, WritableStream } from '@yume-chan/stream-extra';
import { afterEach, expect, it, vi } from 'vitest';

import type { CloudAdbConnection } from '../cloud-adb.js';
import { CloudScrcpyProvider } from '../cloud-scrcpy.js';
import type { PhonePointer } from '../live-provider.js';

vi.mock('../scrcpy.js', async importOriginal => ({ ...await importOriginal<typeof import('../scrcpy.js')>(), readScrcpyServer: async () => Buffer.from('verified-server') }));

const providers: CloudScrcpyProvider[] = [];
afterEach(async () => { for (const provider of providers.splice(0)) await provider.close(); vi.restoreAllMocks(); });
function fixture() {
  const writes: Buffer[] = [];
  const services: string[] = [];
  const channels: { close: ReturnType<typeof vi.fn> }[] = [];
  const createSocket = vi.fn(async (service: string) => {
    services.push(service);
    let end!: () => void;
    const readable = new ReadableStream<Uint8Array>({ start(controller) { end = () => controller.close(); } });
    const close = vi.fn(async () => { end(); });
    channels.push({ close });
    return { readable, writable: new WritableStream<Uint8Array>({ write(bytes) { writes.push(Buffer.from(bytes)); } }), close };
  });
  const sync = { write: vi.fn(async () => {}), dispose: vi.fn(async () => {}) };
  const connection = { client: vi.fn(async () => ({ sync: async () => sync, createSocket })),
    command: vi.fn(async () => Buffer.alloc(0)), close: vi.fn(), dispose: vi.fn(),
    driver: () => ({ foreground: vi.fn(async () => 'com.android.settings') }) };
  const failed = vi.fn();
  const provider = new CloudScrcpyProvider('cloud.example:10001', Buffer.alloc(0), failed, () => connection as unknown as CloudAdbConnection);
  providers.push(provider);
  return { provider, connection, sync, channels, services, writes, failed };
}
const pointer = (phase: PhonePointer['phase']): PhonePointer => ({ type: 'pointer', phase, seq: 1, epoch: 1, geometry: 1, x: 500, y: 500 });
it('uploads the verified server and multiplexes video and control on a dedicated cloud connection', async () => {
  const f = fixture(); await f.provider.start();
  expect(f.sync.write).toHaveBeenCalledWith(expect.objectContaining({ filename: expect.stringMatching(/^\/data\/local\/tmp\/xopc-scrcpy_.*\.jar$/), permission: 0o600 }));
  expect(f.sync.dispose).toHaveBeenCalledOnce();
  expect(f.services[0]).toMatch(/^exec:CLASSPATH=.*audio=false control=true/);
  expect(f.services[1]).toMatch(/^localabstract:scrcpy_/); expect(f.services[2]).toBe(f.services[1]);
  expect(f.services.join(' ')).not.toContain('tcp:');
  f.provider.geometry = { width: 544, height: 960, version: 1, codec: 'avc1.42c029' };
  await f.provider.pointer(pointer('down')); await f.provider.pointer(pointer('move'));
  await f.provider.revoke();
  expect(f.writes.map(bytes => bytes[1])).toEqual([0, 2, 3]);
  await expect(f.provider.pointer(pointer('move'))).rejects.toThrow('Invalid pointer');
  await f.provider.close(); expect(f.channels.every(channel => channel.close.mock.calls.length === 1)).toBe(true);
  expect(f.connection.dispose).toHaveBeenCalledOnce(); expect(f.failed).not.toHaveBeenCalled();
});
it('releases a held touch before closing cloud sockets and disposes authentication on setup failure', async () => {
  const f = fixture(); await f.provider.start();
  f.provider.geometry = { width: 544, height: 960, version: 1, codec: '' };
  await f.provider.pointer(pointer('down')); await f.provider.close();
  expect(f.writes.map(bytes => bytes[1])).toEqual([0, 3]);
  const failed = fixture(); failed.sync.write.mockRejectedValueOnce(new Error('upload refused'));
  await expect(failed.provider.start()).rejects.toThrow('upload refused');
  expect(failed.sync.dispose).toHaveBeenCalledOnce(); expect(failed.connection.dispose).toHaveBeenCalledOnce();
});
it('waits for an in-flight upload to settle before completing a cancelled startup', async () => {
  const f = fixture(); let finish!: () => void;
  f.sync.write.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const starting = f.provider.start();
  const rejected = expect(starting).rejects.toThrow('Video closed');
  await vi.waitFor(() => expect(f.sync.write).toHaveBeenCalledOnce());
  const closing = f.provider.close(); finish(); await rejected; await closing;
  expect(f.services).toEqual([]); expect(f.connection.dispose).toHaveBeenCalledOnce();
});
