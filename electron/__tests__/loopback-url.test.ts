import { describe, expect, it } from 'vitest';

import { isEmbeddedGatewayLoopbackUrl, isEmbeddedGatewaySiteShareUrl } from '../loopback-url.js';

describe('isEmbeddedGatewayLoopbackUrl', () => {
  it('accepts loopback gateway SPA URLs', () => {
    expect(isEmbeddedGatewayLoopbackUrl('http://127.0.0.1:18790/?token=abc#/chat')).toBe(true);
    expect(isEmbeddedGatewayLoopbackUrl('http://localhost:18790/')).toBe(true);
    expect(isEmbeddedGatewayLoopbackUrl('http://127.0.0.2:8080/api/config')).toBe(true);
  });

  it('rejects non-loopback http(s) URLs', () => {
    expect(isEmbeddedGatewayLoopbackUrl('https://xopc.ai/docs')).toBe(false);
    expect(isEmbeddedGatewayLoopbackUrl('http://192.168.1.10:18790/')).toBe(false);
  });

  it('rejects non-http schemes', () => {
    expect(isEmbeddedGatewayLoopbackUrl('data:text/html,hello')).toBe(false);
    expect(isEmbeddedGatewayLoopbackUrl('file:///C:/tmp/index.html')).toBe(false);
  });
});

describe('isEmbeddedGatewaySiteShareUrl', () => {
  it('accepts published sites on the embedded gateway', () => {
    expect(isEmbeddedGatewaySiteShareUrl('http://127.0.0.1:18790/site/pDrGMjE04exInBRdRsXI3w1JIwM4HFOY/')).toBe(true);
    expect(isEmbeddedGatewaySiteShareUrl('http://localhost:18790/site/example/assets/app.js')).toBe(true);
  });

  it('rejects gateway console paths and non-loopback site shares', () => {
    expect(isEmbeddedGatewaySiteShareUrl('http://127.0.0.1:18790/#/chat')).toBe(false);
    expect(isEmbeddedGatewaySiteShareUrl('https://share.example.com/site/example/')).toBe(false);
  });
});
