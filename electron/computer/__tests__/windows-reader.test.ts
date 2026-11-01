import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WindowsNativeReader } from '../windows-reader.js';

const io = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: io.spawn }));
const readers: WindowsNativeReader[] = [];
afterEach(() => { for (const reader of readers.splice(0)) reader.close(); vi.useRealTimers(); vi.resetAllMocks(); });
function fixture() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  io.spawn.mockReturnValue(child);
  const reader = new WindowsNativeReader('read-only fixture script'); readers.push(reader);
  const requests: string[] = [];
  child.stdin.on('data', data => requests.push(data.toString()));
  return { reader, child, requests };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
describe('private Windows identity reader', () => {
  it('reuses only compiled code while reading fresh state for every serialized request', async () => {
    const f = fixture();
    const first = f.reader.read({ pid: 42, windowId: '9', includeInput: true });
    const second = f.reader.read({ pid: 42, windowId: '9', includeInput: true });
    await tick(); expect(f.requests).toHaveLength(1);
    f.child.stdout.write('{"state":1}\n'); expect(await first).toEqual({ state: 1 });
    await tick(); expect(f.requests).toHaveLength(2);
    f.child.stdout.write('{"state":2}\n'); expect(await second).toEqual({ state: 2 });
    expect(io.spawn).toHaveBeenCalledOnce();
    expect(io.spawn.mock.calls[0][2]).toMatchObject({ windowsHide: true });
    expect(JSON.parse(f.requests[0])).toEqual({ pid: 42, windowId: '9', includeInput: true });
  });
  it('accepts fragmented JSON but never returns a partial response', async () => {
    const f = fixture(), result = f.reader.read({ pid: 42, includeInput: false });
    await tick(); f.child.stdout.write('{"state":'); await tick(); f.child.stdout.write('3}\n');
    expect(await result).toEqual({ state: 3 });
  });
  it.each(['not-json\n', 'x'.repeat(65537)])('kills the reader on malformed or oversized output', async output => {
    const f = fixture(), result = f.reader.read({ pid: 42, includeInput: false });
    const rejected = expect(result).rejects.toThrow('COMPUTER_NATIVE_IDENTITY_UNAVAILABLE');
    await tick(); f.child.stdout.write(output); await rejected;
    expect(f.child.kill).toHaveBeenCalledOnce();
  });
  it('cancels the pending read and discards its worker rather than consuming a late response', async () => {
    const f = fixture(), controller = new AbortController();
    const result = f.reader.read({ pid: 42, includeInput: true }, controller.signal);
    const rejected = expect(result).rejects.toThrow('COMPUTER_NATIVE_IDENTITY_UNAVAILABLE');
    await tick(); controller.abort(); await rejected; expect(f.child.kill).toHaveBeenCalledOnce();
  });
  it('bounds a hung UIA read', async () => {
    vi.useFakeTimers(); const f = fixture();
    const result = f.reader.read({ pid: 42, includeInput: true });
    const rejected = expect(result).rejects.toThrow('COMPUTER_NATIVE_IDENTITY_UNAVAILABLE');
    await vi.advanceTimersByTimeAsync(8001); await rejected; expect(f.child.kill).toHaveBeenCalledOnce();
  });
  it('does not restart queued reads after its driver is disposed', async () => {
    const f = fixture();
    const first = f.reader.read({ pid: 42, includeInput: false });
    const second = f.reader.read({ pid: 42, includeInput: false });
    const a = expect(first).rejects.toThrow('COMPUTER_NATIVE_IDENTITY_UNAVAILABLE');
    const b = expect(second).rejects.toThrow('COMPUTER_NATIVE_IDENTITY_UNAVAILABLE');
    await tick(); f.reader.dispose(); await Promise.all([a, b]);
    expect(io.spawn).toHaveBeenCalledOnce();
  });
});
