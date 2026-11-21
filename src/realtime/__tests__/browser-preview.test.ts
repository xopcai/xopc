import { afterEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_PREVIEW_LEASE_MS, type BrowserPreviewServerMessage } from '@xopcai/realtime-protocol';

import { BrowserPreviewRuntime } from '../browser-preview.js';

function fixture() {
  const target = {
    conversationId: crypto.randomUUID(), runId: crypto.randomUUID(), endpointId: 'chrome-a',
    browserSessionId: crypto.randomUUID(), tabId: 7, origin: 'https://example.test',
  };
  const run = { id: target.runId };
  const runtime = new BrowserPreviewRuntime(() => run.id);
  const source = { principalId: 'source', source: { endpointId: target.endpointId, isCurrent: () => true },
    isActive: () => true, send: vi.fn<(message: BrowserPreviewServerMessage) => void>() };
  const viewer = { principalId: 'pc', viewer: 'PC', isActive: () => true, send: vi.fn<(message: BrowserPreviewServerMessage) => void>() };
  const outsider = { ...viewer, principalId: 'outsider', send: vi.fn<(message: BrowserPreviewServerMessage) => void>() };
  runtime.setTarget(target);
  runtime.register(source);
  runtime.register(viewer);
  const requestId = crypto.randomUUID();
  runtime.receive(viewer, { type: 'view', conversationId: target.conversationId, requestId });
  return { runtime, target, source, viewer, outsider, requestId, run };
}

afterEach(() => vi.useRealTimers());

describe('browser preview signaling', () => {
  it('only delivers an offer after source consent, and forwards it to the bound Chrome connection', () => {
    const { runtime, source, viewer, outsider, requestId } = fixture();
    expect(source.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'requested', requestId, tabId: 7 }));
    expect(viewer.send).toHaveBeenCalledWith({ type: 'waiting', requestId, origin: 'https://example.test' });
    source.send.mockClear();
    viewer.send.mockClear();
    const offer = { type: 'signal', requestId, signal: { type: 'offer', sdp: 'test offer' } } as const;
    runtime.receive(viewer, offer);
    runtime.receive(outsider, { type: 'accept', requestId });
    runtime.receive(viewer, { type: 'accept', requestId });
    expect(source.send).not.toHaveBeenCalled();
    expect(viewer.send).not.toHaveBeenCalled();
    runtime.receive(source, { type: 'accept', requestId });
    runtime.receive(outsider, offer);
    expect(source.send.mock.calls.map(([message]) => message.type)).toEqual(['accepted', 'lease']);
    runtime.receive(viewer, offer);
    expect(source.send).toHaveBeenLastCalledWith(offer);
    const answer = { type: 'signal', requestId, signal: { type: 'answer', sdp: 'test answer' } } as const;
    runtime.receive(viewer, answer);
    runtime.receive(source, answer);
    expect(viewer.send).toHaveBeenLastCalledWith(answer);
    expect(outsider.send).not.toHaveBeenCalled();
  });

  it('closes on lease expiry and run replacement, and never reuses an old request after navigation', () => {
    vi.useFakeTimers();
    const { runtime, source, viewer, requestId, target, run } = fixture();
    runtime.receive(source, { type: 'accept', requestId });
    vi.advanceTimersByTime(BROWSER_PREVIEW_LEASE_MS - 100);
    runtime.receive(viewer, { type: 'renew', requestId });
    vi.advanceTimersByTime(BROWSER_PREVIEW_LEASE_MS + 1);
    runtime.sweep();
    expect(source.send).toHaveBeenLastCalledWith({ type: 'closed', requestId, reason: 'expired' });
    expect(viewer.send).toHaveBeenLastCalledWith({ type: 'closed', requestId, reason: 'expired' });

    const next = crypto.randomUUID();
    runtime.receive(viewer, { type: 'view', conversationId: target.conversationId, requestId: next });
    runtime.setTarget({ ...target, tabId: 8 });
    expect(viewer.send).toHaveBeenLastCalledWith({ type: 'closed', requestId: next, reason: 'ended' });
    viewer.send.mockClear();
    runtime.receive(source, { type: 'accept', requestId: next });
    expect(viewer.send).not.toHaveBeenCalled();

    run.id = crypto.randomUUID();
    runtime.sweep();
    expect(runtime.available(target.conversationId)).toBe(false);
  });

  it('supports a second isolated viewer and authorizes snapshots only for its own live request', () => {
    const { runtime, target, source, viewer, outsider, requestId } = fixture();
    const mobile = { ...outsider, viewer: 'Android' };
    const second = crypto.randomUUID();
    runtime.receive(mobile, { type: 'view', conversationId: target.conversationId, requestId: second });
    runtime.receive(source, { type: 'accept', requestId });
    runtime.receive(source, { type: 'accept', requestId: second });
    const third = crypto.randomUUID();
    runtime.receive({ ...outsider }, { type: 'view', conversationId: target.conversationId, requestId: third });
    expect(outsider.send).toHaveBeenLastCalledWith({ type: 'closed', requestId: third, reason: 'busy' });

    runtime.receive(mobile, { type: 'quality', requestId: second, quality: 'snapshot' });
    const request = source.send.mock.lastCall?.[0];
    expect(request).toMatchObject({ type: 'quality', requestId: second, quality: 'snapshot' });
    expect(viewer.send.mock.calls.some(([message]) => message.type === 'quality')).toBe(false);
    const token = request?.type === 'quality' ? request.snapshotToken! : '';
    const bytes = Uint8Array.from([0xff, 0xd8, 1, 0xff, 0xd9]);
    expect(runtime.publishSnapshot(second, 'pc', token, bytes)).toBe(false);
    expect(runtime.publishSnapshot(second, 'source', token, bytes)).toBe(true);
    expect(runtime.readSnapshot(second, 'pc', token, 0)).toBeUndefined();
    expect(runtime.readSnapshot(second, 'outsider', token, 0)?.snapshot?.bytes).toEqual(bytes);
    expect(runtime.readSnapshot(second, 'outsider', token, 1)?.snapshot).toBeUndefined();
    runtime.receive(mobile, { type: 'close', requestId: second });
    expect(runtime.readSnapshot(second, 'outsider', token, 0)).toBeUndefined();
    runtime.receive(viewer, { type: 'renew', requestId });
    expect(viewer.send).toHaveBeenLastCalledWith({ type: 'lease', requestId });
  });

});
