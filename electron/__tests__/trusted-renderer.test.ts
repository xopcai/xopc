import { describe, expect, it } from 'vitest';

import { isTrustedElectronRendererUrl } from '../ipc/trusted-renderer.js';

describe('isTrustedElectronRendererUrl', () => {
  it('allows embedded loopback gateway URLs', () => {
    expect(isTrustedElectronRendererUrl('http://127.0.0.1:18790/?token=abc#/chat')).toBe(true);
    expect(isTrustedElectronRendererUrl('http://localhost:5173/#/chat')).toBe(true);
  });

  it('rejects non-loopback and non-http URLs', () => {
    expect(isTrustedElectronRendererUrl('https://xopc.ai/docs')).toBe(false);
    expect(isTrustedElectronRendererUrl('file:///tmp/index.html')).toBe(false);
    expect(isTrustedElectronRendererUrl(undefined)).toBe(false);
  });
});
