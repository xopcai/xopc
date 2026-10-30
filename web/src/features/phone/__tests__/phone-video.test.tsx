// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn(async () => ({ payload: { ticket: 'ticket', path: '/api/phone/live/v1/ws' } })) }));
import { usePhoneVideo } from '../use-phone-video';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let hook: ReturnType<typeof usePhoneVideo>; let root: ReturnType<typeof createRoot>;
let node: HTMLDivElement;
class FakeSocket {
  static OPEN = 1; readyState = 1; bufferedAmount = 0; binaryType = ''; sent: any[] = [];
  onmessage?: (event: { data: string }) => void; onclose?: () => void;
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; }
}
let socket: FakeSocket;
afterEach(async () => { await act(async () => root?.unmount()); node?.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('writes DOWN immediately, coalesces cloud MOVEs behind ACKs, and releases without waiting on blur', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', class extends FakeSocket { constructor() { super(); socket = this; } });
  vi.stubGlobal('VideoDecoder', class { state = 'configured'; configure() {} close() { this.state = 'closed'; } });
  vi.stubGlobal('isSecureContext', true);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: vi.fn() } as unknown as CanvasRenderingContext2D);
  function Harness() { const canvas = useRef<HTMLCanvasElement>(null); hook = usePhoneVideo('conversation', 'session', true, canvas, 2); return <canvas ref={canvas} />; }
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  await act(async () => root.render(<Harness />));
  await act(async () => socket.onmessage?.({ data: JSON.stringify({ type: 'geometry', width: 576, height: 1280, version: 1, codec: 'avc1.42c029' }) }));
  act(() => { hook.pointer('down', [500, 800]); hook.pointer('move', [500, 700]); hook.pointer('move', [500, 650]); });
  expect(socket.sent.map(s => s.phase)).toEqual(['down']);
  await act(async () => { await vi.advanceTimersByTimeAsync(25); });
  expect(socket.sent.map(s => s.phase)).toEqual(['down']);
  await act(async () => socket.onmessage?.({ data: JSON.stringify({ type: 'ack', seq: socket.sent[0].seq }) }));
  expect(socket.sent.map(s => s.phase)).toEqual(['down', 'move']); expect(socket.sent[1].y).toBe(650);
  act(() => { hook.pointer('move', [500, 620]); hook.pointer('move', [500, 610]); });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(socket.sent.map(s => s.phase)).toEqual(['down', 'move']);
  await act(async () => socket.onmessage?.({ data: JSON.stringify({ type: 'ack', seq: socket.sent[1].seq }) }));
  expect(socket.sent.at(-1).y).toBe(610);
  act(() => { hook.pointer('up', [500, 600]); }); expect(socket.sent.at(-1).phase).toBe('up'); expect(socket.sent.at(-1).durationMs).toBe(275);
  act(() => { hook.pointer('down', [100, 100]); window.dispatchEvent(new Event('blur')); });
  expect(socket.sent.at(-1)).toEqual({ type: 'cancelPointers', epoch: 2 });
  await act(async () => {
    socket.onmessage?.({ data: JSON.stringify({ type: 'fault', code: 'PHONE_CONTROL_CHANGED' }) });
    socket.onclose?.();
  });
  expect(hook.error).toBe('PHONE_CONTROL_CHANGED');
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  expect(hook.error).toBe('PHONE_CONTROL_CHANGED');
});
