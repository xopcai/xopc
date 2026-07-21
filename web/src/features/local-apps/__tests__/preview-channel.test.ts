// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { attachLocalAppPreviewChannel, LOCAL_APP_PREVIEW_CONNECT_MESSAGE } from '../preview-channel';

describe('local app preview channel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('transfers a private port only after iframe load and closes it on cleanup', () => {
    const transferredPort = { id: 'child' } as unknown as MessagePort;
    const hostPort = { close: vi.fn(), start: vi.fn(), onmessage: null } as unknown as MessagePort;
    vi.stubGlobal('MessageChannel', class {
      port1 = hostPort;
      port2 = transferredPort;
    });
    const iframe = document.createElement('iframe');
    const postMessage = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage } });

    const cleanup = attachLocalAppPreviewChannel(iframe, vi.fn());
    expect(postMessage).not.toHaveBeenCalled();
    iframe.dispatchEvent(new Event('load'));

    expect(hostPort.start).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith(LOCAL_APP_PREVIEW_CONNECT_MESSAGE, '*', [transferredPort]);
    cleanup();
    expect(hostPort.close).toHaveBeenCalledOnce();
  });
});
