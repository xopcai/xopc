import { describe, expect, it } from 'vitest';

import { PROBE_TIMING } from '../probe-timing';

describe('PROBE_TIMING', () => {
  it('keeps the LAN probe strictly faster than the tunnel probe', () => {
    expect(PROBE_TIMING.TIMEOUT_LAN_MS).toBeLessThan(PROBE_TIMING.TIMEOUT_TUNNEL_MS);
  });

  it('keeps the LAN head-start short enough that tunnel can win quickly', () => {
    expect(PROBE_TIMING.LAN_HEAD_START_MS).toBeLessThan(PROBE_TIMING.TIMEOUT_LAN_MS);
  });

  it('caps the race below the foreground recheck interval', () => {
    expect(PROBE_TIMING.RACE_HARD_TIMEOUT_MS).toBeLessThan(PROBE_TIMING.FOREGROUND_RECHECK_MS);
  });
});
