import { describe, expect, it, vi } from 'vitest';

import { createGatewayStartupTrace, isGatewayStartupTraceEnabled } from '../startup-trace.js';

describe('createGatewayStartupTrace', () => {
  it('is disabled by default', () => {
    expect(isGatewayStartupTraceEnabled({})).toBe(false);
    const trace = createGatewayStartupTrace(false);
    expect(typeof trace.measure).toBe('function');
    expect(typeof trace.mark).toBe('function');
  });

  it('measures async work when enabled', async () => {
    const trace = createGatewayStartupTrace(true);
    const value = await trace.measure('test.phase', async () => {
      await Promise.resolve();
      return 42;
    });
    expect(value).toBe(42);
    trace.mark('ready');
  });

  it('respects env flag', () => {
    expect(isGatewayStartupTraceEnabled({ XOPC_GATEWAY_STARTUP_TRACE: '1' })).toBe(true);
    expect(isGatewayStartupTraceEnabled({ XOPC_GATEWAY_STARTUP_TRACE: '0' })).toBe(false);
  });
});
