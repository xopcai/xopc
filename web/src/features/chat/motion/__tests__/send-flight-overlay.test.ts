import { describe, expect, it } from 'vitest';

import {
  buildSendFlightGeometry,
  isSendFlightRectStable,
  sendFlightDurationMs,
} from '../send-flight-overlay';

describe('buildSendFlightGeometry', () => {
  it('starts at the composer and lands on the message bubble', () => {
    expect(buildSendFlightGeometry(
      { left: 24, top: 700, width: 620, height: 48 },
      { left: 420, top: 520, width: 240, height: 64 },
      { width: 800, height: 800 },
    )).toEqual({
      left: 24,
      top: 692,
      width: 240,
      height: 64,
      destinationLeft: 420,
      destinationTop: 520,
    });
  });

  it('falls back instead of resizing an oversized destination bubble', () => {
    expect(buildSendFlightGeometry(
      { left: -20, top: 760, width: 700, height: 40 },
      { left: 600, top: -30, width: 300, height: 260 },
      { width: 800, height: 800 },
    )).toBeNull();
  });

  it('rejects invalid source or target measurements', () => {
    expect(buildSendFlightGeometry(
      { left: 0, top: 0, width: 0, height: 40 },
      { left: 10, top: 10, width: 100, height: 40 },
      { width: 800, height: 800 },
    )).toBeNull();
  });

  it('uses a calm distance-aware duration with bounded extremes', () => {
    const short = buildSendFlightGeometry(
      { left: 100, top: 600, width: 500, height: 48 },
      { left: 120, top: 580, width: 220, height: 56 },
      { width: 800, height: 800 },
    );
    const long = buildSendFlightGeometry(
      { left: 20, top: 740, width: 700, height: 48 },
      { left: 560, top: 80, width: 220, height: 56 },
      { width: 800, height: 800 },
    );
    if (!short || !long) throw new Error('expected valid flight geometry');

    expect(sendFlightDurationMs(short)).toBeGreaterThanOrEqual(480);
    expect(sendFlightDurationMs(long)).toBeGreaterThan(sendFlightDurationMs(short));
    expect(sendFlightDurationMs(long)).toBeLessThanOrEqual(620);
  });
});

describe('isSendFlightRectStable', () => {
  const rect = { left: 182, top: 156, width: 134, height: 49 };

  it('accepts subpixel compositor noise while the target is settled', () => {
    expect(isSendFlightRectStable(rect, {
      left: 182.4,
      top: 155.6,
      width: 134.2,
      height: 49,
    })).toBe(true);
  });

  it('waits when automatic scrolling moves the destination', () => {
    expect(isSendFlightRectStable(rect, {
      ...rect,
      top: 200,
    })).toBe(false);
  });
});
