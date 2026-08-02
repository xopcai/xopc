// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { attachLocalAppPreviewChannel, LOCAL_APP_PREVIEW_CONNECT_MESSAGE } from '../preview-channel';

describe('local app preview channel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('connects immediately, reconnects after iframe load, and closes stale ports', () => {
    const hostPorts: Array<{ close: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; onmessage: unknown }> = [];
    const transferredPorts: Array<{ id: number }> = [];
    vi.stubGlobal('MessageChannel', class {
      port1 = { close: vi.fn(), start: vi.fn(), onmessage: null };
      port2 = { id: transferredPorts.length };

      constructor() {
        hostPorts.push(this.port1);
        transferredPorts.push(this.port2);
      }
    });
    const iframe = document.createElement('iframe');
    const postMessage = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage } });

    const cleanup = attachLocalAppPreviewChannel(iframe, vi.fn());
    expect(postMessage).toHaveBeenCalledWith(LOCAL_APP_PREVIEW_CONNECT_MESSAGE, '*', [transferredPorts[0]]);
    iframe.dispatchEvent(new Event('load'));

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenLastCalledWith(LOCAL_APP_PREVIEW_CONNECT_MESSAGE, '*', [transferredPorts[1]]);
    expect(hostPorts[0]?.start).toHaveBeenCalledOnce();
    expect(hostPorts[0]?.close).toHaveBeenCalledOnce();
    expect(hostPorts[1]?.start).toHaveBeenCalledOnce();
    cleanup();
    expect(hostPorts[1]?.close).toHaveBeenCalledOnce();
  });
});
