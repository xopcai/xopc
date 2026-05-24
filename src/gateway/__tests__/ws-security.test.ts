import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  assertSecureGatewayHttpUrl,
  assertSecureWebSocketUrl,
  isSecureWebSocketUrl,
} from '../ws-security.js';

describe('ws-security', () => {
  const prev = process.env.XOPC_ALLOW_INSECURE_PRIVATE_WS;

  beforeEach(() => {
    delete process.env.XOPC_ALLOW_INSECURE_PRIVATE_WS;
  });

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.XOPC_ALLOW_INSECURE_PRIVATE_WS;
    } else {
      process.env.XOPC_ALLOW_INSECURE_PRIVATE_WS = prev;
    }
  });

  it('allows wss and loopback ws', () => {
    expect(isSecureWebSocketUrl('wss://example.com/gateway')).toBe(true);
    expect(isSecureWebSocketUrl('ws://127.0.0.1:18790/events')).toBe(true);
    expect(isSecureWebSocketUrl('ws://localhost:18790/events')).toBe(true);
  });

  it('rejects plaintext ws to remote hosts by default', () => {
    expect(isSecureWebSocketUrl('ws://192.168.1.10:18790/events')).toBe(false);
    expect(() => assertSecureWebSocketUrl('ws://192.168.1.10:18790/events')).toThrow(
      /insecure WebSocket URL rejected/,
    );
  });

  it('allows private ws when break-glass env is set', () => {
    process.env.XOPC_ALLOW_INSECURE_PRIVATE_WS = '1';
    expect(isSecureWebSocketUrl('ws://192.168.1.10:18790/events')).toBe(true);
  });

  it('validates gateway HTTP URLs', () => {
    expect(() => assertSecureGatewayHttpUrl('http://127.0.0.1:18790')).not.toThrow();
    expect(() => assertSecureGatewayHttpUrl('https://gateway.example.com')).not.toThrow();
    expect(() => assertSecureGatewayHttpUrl('http://192.168.1.10:18790')).toThrow(
      /insecure gateway HTTP URL rejected/,
    );
  });
});
