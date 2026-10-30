import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerPreviewManager, type PreviewDependencies, type PreviewPixels } from '../preview-manager.js';
import type { ComputerPreviewAuthority } from '../../../src/computer/broker.js';

afterEach(() => vi.useRealTimers());
function fixture() {
  const controller = new AbortController();
  let authority: ComputerPreviewAuthority | undefined = { conversationId: 'conversation', runId: 'run', computerSessionId: 'session',
    brokerEpoch: 'broker', appName: 'Fixture', status: 'ready', signal: controller.signal,
    target: { pid: 42, processIdentity: '42:start', appId: 'fixture', windowId: '9', width: 640, height: 480, geometryRevision: 'g' } };
  let deliver!: (pixels: PreviewPixels) => Promise<void>;
  const capture = { close: vi.fn(), setPreset: vi.fn() };
  const deps: PreviewDependencies = { authority: () => authority?.signal.aborted ? undefined : authority,
    validate: vi.fn(async () => {}), capture: vi.fn(async (_authority, _preset, frame) => { deliver = frame; return capture; }), changed: vi.fn() };
  const manager = new ComputerPreviewManager(deps);
  const sink = { send: vi.fn(), close: vi.fn() };
  const start = async () => { const id = manager.subscribe('conversation', 'run', 'compact', sink); await Promise.resolve(); await Promise.resolve(); return id; };
  return { manager, deps, capture, sink, controller, start, frame: () => deliver({ width: 640, height: 480, bytes: new Uint8Array([1, 2]) }),
    replace: (next: ComputerPreviewAuthority | undefined) => { authority = next; }, authority: () => authority };
}
describe('scoped Computer preview', () => {
  it('never starts a capture for another conversation or run', () => {
    const f = fixture();
    expect(() => f.manager.subscribe('other', 'run', 'compact', f.sink)).toThrow('SESSION_UNAVAILABLE');
    expect(() => f.manager.subscribe('conversation', 'other', 'compact', f.sink)).toThrow('SESSION_UNAVAILABLE');
    expect(f.deps.capture).not.toHaveBeenCalled(); f.manager.dispose();
  });
  it('holds the next frame until presentation acknowledgement and ignores stale acknowledgements', async () => {
    const f = fixture(), id = await f.start();
    let presented = false;
    const pending = f.frame().then(() => { presented = true; });
    const frame = f.sink.send.mock.calls.at(-1)![0];
    f.manager.acknowledge('wrong', frame.streamEpoch, frame.sequence);
    await Promise.resolve(); expect(presented).toBe(false);
    f.manager.acknowledge(id, frame.streamEpoch, frame.sequence);
    await pending; expect(presented).toBe(true); f.manager.dispose();
  });
  it('bounds a stalled subscriber without blocking future input or growing a queue', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.start();
    const pending = f.frame(); await vi.advanceTimersByTimeAsync(1500); await pending;
    expect(f.sink.send.mock.calls.filter(([item]) => 'sequence' in item)).toHaveLength(1);
    expect(f.capture.close).toHaveBeenCalledOnce(); expect(f.manager.current('conversation')?.status).toBe('unavailable');
    f.manager.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('pauses the capture independently of the authorized control session', async () => {
    const f = fixture(), id = await f.start(); f.manager.setPreset(id, 'paused');
    expect(f.capture.close).toHaveBeenCalledOnce(); expect(f.controller.signal.aborted).toBe(false);
    expect(f.manager.current('conversation')?.status).toBe('paused');
    f.manager.setPreset(id, 'expanded'); await Promise.resolve(); await Promise.resolve();
    expect(f.deps.capture).toHaveBeenCalledTimes(2); f.manager.dispose();
  });
  it('stops a pending capture immediately when its authority is revoked', async () => {
    const f = fixture(); let finish!: () => void;
    f.deps.validate = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    await f.start(); f.controller.abort(); finish(); await Promise.resolve();
    expect(f.deps.capture).not.toHaveBeenCalled(); expect(f.manager.current('conversation')?.status).toBe('ended'); f.manager.dispose();
  });
  it('cancels a starting backend before resuming a paused preview', async () => {
    const f = fixture(); let startedSignal: AbortSignal | undefined;
    let finish!: (capture: typeof f.capture) => void;
    f.deps.capture = vi.fn(async authority => {
      startedSignal = authority.signal;
      return await new Promise<typeof f.capture>(resolve => { finish = resolve; });
    });
    const id = await f.start();
    f.manager.setPreset(id, 'paused');
    expect(startedSignal?.aborted).toBe(true);
    finish(f.capture); await Promise.resolve(); await Promise.resolve();
    expect(f.capture.close).toHaveBeenCalledOnce(); f.manager.dispose();
  });
  it('drops a late frame from a replaced target and revokes the old stop handle', async () => {
    const f = fixture(), id = await f.start();
    const oldFrame = f.frame;
    f.replace({ ...f.authority()!, target: { ...f.authority()!.target!, windowId: '10' } }); f.manager.sync();
    const count = f.sink.send.mock.calls.length; await oldFrame();
    expect(f.sink.send).toHaveBeenCalledTimes(count);
    expect(() => f.manager.controlSession(id)).toThrow('REVOKED');
    expect(f.capture.close).toHaveBeenCalledOnce(); f.manager.dispose();
  });
  it('isolates broken presentation callbacks from Broker state changes', async () => {
    const f = fixture(); f.deps.changed = () => { throw new Error('renderer closed'); };
    expect(() => f.manager.sync()).not.toThrow(); await f.start();
    f.sink.send.mockImplementation(() => { throw new Error('closed'); });
    await expect(f.frame()).resolves.toBeUndefined(); f.manager.dispose();
  });
});
