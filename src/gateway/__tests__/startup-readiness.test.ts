import { describe, expect, it } from 'vitest';

import {
  buildStartupUnavailablePayload,
  GatewayReadiness,
  parseStartupRetryAfterMs,
} from '../startup-readiness.js';

describe('GatewayReadiness', () => {
  it('tracks ready and httpListening transitions', () => {
    const readiness = new GatewayReadiness();
    readiness.markStarting(1000);
    expect(readiness.isReady()).toBe(false);
    expect(readiness.isHttpListening()).toBe(false);

    readiness.markHttpListening();
    expect(readiness.getSnapshot().httpListening).toBe(true);
    expect(readiness.isReady()).toBe(false);

    readiness.markReady();
    expect(readiness.isReady()).toBe(true);
    expect(readiness.getSnapshot().startupDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('markReady is idempotent', () => {
    const readiness = new GatewayReadiness();
    readiness.markStarting(0);
    readiness.markReady();
    readiness.markReady();
    expect(readiness.getSnapshot().readyAtMs).not.toBeNull();
  });
});

describe('buildStartupUnavailablePayload', () => {
  it('returns retryable startup payload', () => {
    const payload = buildStartupUnavailablePayload({
      method: 'sessions.history',
      retryAfterMs: 750,
    });
    expect(payload.code).toBe('STARTUP_UNAVAILABLE');
    expect(payload.retryable).toBe(true);
    expect(payload.retryAfterMs).toBe(750);
    expect(payload.method).toBe('sessions.history');
  });
});

describe('parseStartupRetryAfterMs', () => {
  it('clamps retry delay', () => {
    expect(parseStartupRetryAfterMs(50)).toBe(100);
    expect(parseStartupRetryAfterMs(9000)).toBe(5000);
    expect(parseStartupRetryAfterMs(undefined)).toBe(500);
  });
});
