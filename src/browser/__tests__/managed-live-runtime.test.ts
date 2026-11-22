import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BrowserInteractiveInput, ManagedBrowserFrame, ManagedBrowserLiveHandle } from '../drivers/browser-driver.js';
import { MANAGED_BROWSER_CONTROL_LEASE_MS, ManagedBrowserLiveRuntime } from '../managed-live-runtime.js';

function createFixture() {
  let frameHandler: ((frame: ManagedBrowserFrame) => void) | undefined;
  const stopScreencast = vi.fn().mockResolvedValue(undefined);
  const dispatchInput = vi.fn<(input: BrowserInteractiveInput) => Promise<void>>().mockResolvedValue(undefined);
  const invalidateRefs = vi.fn();
  const handle: ManagedBrowserLiveHandle = {
    sessionId: 'browser-sess-1',
    getViewport: () => ({ width: 1280, height: 720, version: 1 }),
    getUrl: () => 'https://app.example.test/login',
    getTitle: async () => 'Sign in',
    startScreencast: vi.fn(async (onFrame) => {
      frameHandler = onFrame;
      return stopScreencast;
    }),
    dispatchInput,
    invalidateRefs,
  };
  let runActive = true;
  const waitForIdle = vi.fn().mockResolvedValue(undefined);
  const pinSession = vi.fn();
  const unpinSession = vi.fn();
  const setHumanControlled = vi.fn();
  const resumeBrowserAssistance = vi.fn();

  const runtime = new ManagedBrowserLiveRuntime({
    isRunActive: () => runActive,
    waitForIdle,
    pinSession,
    unpinSession,
    setHumanControlled,
    resumeBrowserAssistance,
  });

  const conversationId = 'conv-managed-1';
  runtime.setSource(conversationId, {
    browserSessionId: 'browser-sess-1',
    handle,
    url: 'https://app.example.test/login',
    title: 'Sign in',
  });

  return {
    runtime,
    conversationId,
    handle,
    emitFrame: (tag: number) => frameHandler?.({
      bytes: Uint8Array.from([0xff, 0xd8, tag, 0xff, 0xd9]),
      width: 1280,
      height: 720,
      timestamp: Date.now(),
    }),
    stopScreencast,
    dispatchInput,
    invalidateRefs,
    waitForIdle,
    pinSession,
    unpinSession,
    setHumanControlled,
    resumeBrowserAssistance,
    setRunActive: (next: boolean) => { runActive = next; },
  };
}

afterEach(() => vi.useRealTimers());

describe('ManagedBrowserLiveRuntime', () => {
  it('wakes waiting viewers immediately on screencast frame and enforces privacy pause during human takeover', async () => {
    const f = createFixture();
    try {
      const mobileActor = { actorKey: 'device-1:c1', principalId: 'device-1', deviceName: 'Pixel 9' };
      const pcActor = { actorKey: 'owner:c2', principalId: 'owner', deviceName: 'xopc' };

      const framePromise = f.runtime.waitForFrame(f.conversationId, pcActor.actorKey, 0, 2000);
      await Promise.resolve();
      f.emitFrame(1);
      const first = await framePromise;
      expect(first.kind).toBe('frame');
      if (first.kind === 'frame') expect(first.frame.seq).toBe(1);

      // PC starts waiting for the next frame while Mobile takes over.
      const pcWait = f.runtime.waitForFrame(f.conversationId, pcActor.actorKey, 1, 2000);
      const taken = await f.runtime.takeover(f.conversationId, mobileActor);
      expect(taken.ownControl).toBe(true);
      expect(taken.status).toBe('human');
      expect(taken.controlEpoch).toBe(1);
      expect(f.waitForIdle).toHaveBeenCalledWith(f.conversationId);
      expect(f.pinSession).toHaveBeenCalledWith(f.conversationId);
      expect(f.setHumanControlled).toHaveBeenCalledWith(f.conversationId, true);

      // Other viewer is immediately privacy-paused without receiving any frame.
      await expect(pcWait).resolves.toEqual({ kind: 'privacy_paused' });
      await expect(f.runtime.waitForFrame(f.conversationId, pcActor.actorKey, 1, 200)).resolves.toEqual({ kind: 'privacy_paused' });

      // Other device cannot take over while Mobile holds the lease.
      await expect(f.runtime.takeover(f.conversationId, pcActor)).rejects.toMatchObject({ code: 'BROWSER_CONTROL_BUSY' });

      // Mobile can dispatch ordered inputs; stale seq is rejected.
      await f.runtime.input(f.conversationId, mobileActor.actorKey, 1, 1, { kind: 'pointer', phase: 'click', x: 0.5, y: 0.5 });
      await f.runtime.input(f.conversationId, mobileActor.actorKey, 1, 2, { kind: 'text', text: 'user@example.test' });
      await expect(
        f.runtime.input(f.conversationId, mobileActor.actorKey, 1, 2, { kind: 'key', key: 'Enter' }),
      ).rejects.toMatchObject({ code: 'BROWSER_INPUT_SEQUENCE' });
      expect(f.dispatchInput).toHaveBeenCalledTimes(2);

      // Releasing on background keeps the session alive so Mobile can retake with epoch 2.
      f.runtime.release(f.conversationId, mobileActor.actorKey, 1);
      expect(f.setHumanControlled).toHaveBeenLastCalledWith(f.conversationId, false);
      const retaken = await f.runtime.takeover(f.conversationId, mobileActor);
      expect(retaken.controlEpoch).toBe(2);

      // Handback invalidates cached DOM refs and unpins.
      f.runtime.handback(f.conversationId, mobileActor.actorKey, 2);
      expect(f.invalidateRefs).toHaveBeenCalledOnce();
      expect(f.unpinSession).toHaveBeenCalledWith(f.conversationId);
    } finally {
      f.runtime.close();
    }
  });

  it('expires abandoned human control leases automatically without closing the browser', async () => {
    vi.useFakeTimers();
    const f = createFixture();
    try {
      const actor = { actorKey: 'device-1:c1', principalId: 'device-1', deviceName: 'Pixel 9' };
      const taken = await f.runtime.takeover(f.conversationId, actor);
      expect(f.runtime.isHumanControlled(f.conversationId)).toBe(true);

      vi.advanceTimersByTime(MANAGED_BROWSER_CONTROL_LEASE_MS + 100);
      f.runtime.sweep();
      expect(f.runtime.isHumanControlled(f.conversationId)).toBe(false);
      await expect(
        f.runtime.input(f.conversationId, actor.actorKey, taken.controlEpoch, 1, { kind: 'key', key: 'Enter' }),
      ).rejects.toMatchObject({ code: 'BROWSER_CONTROL_LOST' });
    } finally {
      f.runtime.close();
    }
  });
});
