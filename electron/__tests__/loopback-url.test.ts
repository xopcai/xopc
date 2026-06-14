import { describe, expect, it } from 'vitest';

import { isEmbeddedGatewayLoopbackUrl } from '../loopback-url.js';

describe('isEmbeddedGatewayLoopbackUrl', () => {
  it('accepts loopback gateway SPA URLs', () => {
    expect(isEmbeddedGatewayLoopbackUrl('http://127.0.0.1:28790/?token=abc#/chat')).toBe(true);
    expect(isEmbeddedGatewayLoopbackUrl('http://localhost:28790/')).toBe(true);
    expect(isEmbeddedGatewayLoopbackUrl('http://127.0.0.2:8080/api/config')).toBe(true);
  });

  it('rejects non-loopback http(s) URLs', () => {
    expect(isEmbeddedGatewayLoopbackUrl('https://xopc.ai/docs')).toBe(false);
    expect(isEmbeddedGatewayLoopbackUrl('http://192.168.1.10:28790/')).toBe(false);
  });

  it('rejects non-http schemes', () => {
    expect(isEmbeddedGatewayLoopbackUrl('data:text/html,hello')).toBe(false);
    expect(isEmbeddedGatewayLoopbackUrl('file:///C:/tmp/index.html')).toBe(false);
  });
});
