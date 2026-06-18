import { describe, expect, it } from 'vitest';

import {
  isLikelyPinoJsonLogLine,
  isLikelyPinoJsonLogPrefix,
} from '../tui-stdio-filter.js';

describe('tui stdio log filtering', () => {
  it('recognizes complete pino JSON log lines', () => {
    expect(
      isLikelyPinoJsonLogLine(
        '{"level":"warn","time":"2026-06-19T04:32:29.575Z","module":"Credentials","msg":"OAuth token is expired"}',
      ),
    ).toBe(true);
    expect(
      isLikelyPinoJsonLogLine(
        '{"level":40,"time":"2026-06-19T04:32:29.575Z","module":"Credentials","msg":"OAuth token is expired"}',
      ),
    ).toBe(true);
  });

  it('recognizes pending pino JSON log prefixes before TUI ANSI redraw chunks', () => {
    expect(
      isLikelyPinoJsonLogPrefix(
        '{"level":40,"time":"2026-06-19T04:32:29.575Z","module":"Credentials"',
      ),
    ).toBe(true);
    expect(isLikelyPinoJsonLogPrefix('{"ok":true}')).toBe(false);
  });
});
