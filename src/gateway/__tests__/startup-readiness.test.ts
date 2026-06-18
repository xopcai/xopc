import { describe, expect, it, vi } from 'vitest';

import {
  buildStartupUnavailablePayload,
  GatewayReadiness,
  parseStartupRetryAfterMs,
} from '../startup-readiness.js';
import { GatewayService } from '../service.js';

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

describe('GatewayService startup readiness', () => {
  it('marks ready before deferred channel connects finish', async () => {
    let finishDeferred!: () => void;
    const deferredConnect = new Promise<void>((resolve) => {
      finishDeferred = resolve;
    });
    const service = Object.create(GatewayService.prototype) as any;

    service.serviceConfig = { deferChannelConnectUntilAfterHttp: true };
    service.readiness = new GatewayReadiness();
    service.readiness.markStarting(Date.now());
    service.startupTrace = null;
    service.channelManager = {
      startDeferredConnects: vi.fn(() => deferredConnect),
      replayPendingOutboundMessages: vi.fn(async () => {}),
    };
    service.startOutboundProcessor = vi.fn(async () => {});
    service.emit = vi.fn();
    service.getChannelsStatus = vi.fn(() => ({}));
    service.runExposureAutoStartIfConfigured = vi.fn(async () => {});
    service.applyStartupReadyDelayForTesting = vi.fn(async () => {});
    service.schedulePostReadySidecars = vi.fn();
    service.lastChannelConnectDeferMode = 'auto';
    service.lastChannelConnectDeferSource = 'meta';
    service.lastDeferredChannelConnectIds = ['telegram'];

    const pending = service.onHttpListening();
    await vi.waitFor(() => expect(service.channelManager.startDeferredConnects).toHaveBeenCalled());

    expect(service.isGatewayReady()).toBe(true);

    finishDeferred();
    await pending;
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
