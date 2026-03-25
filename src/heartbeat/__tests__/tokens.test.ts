import { describe, expect, it } from 'vitest';

import {
  HEARTBEAT_OK,
  NO_REPLY,
  shouldSilence,
  stripHeartbeatToken,
} from '../tokens.js';

describe('stripHeartbeatToken', () => {
  it('detects token and strips plain', () => {
    const { stripped, hadToken } = stripHeartbeatToken(`ok ${HEARTBEAT_OK}`);
    expect(hadToken).toBe(true);
    expect(stripped).toBe('ok');
  });

  it('strips markdown variants', () => {
    expect(stripHeartbeatToken('**HEARTBEAT_OK**').stripped).toBe('');
    expect(stripHeartbeatToken('`HEARTBEAT_OK`').stripped).toBe('');
  });
});

describe('shouldSilence', () => {
  it('silences token-only replies', () => {
    expect(shouldSilence(HEARTBEAT_OK)).toBe(true);
    expect(shouldSilence(`${HEARTBEAT_OK}.`)).toBe(true);
  });

  it('does not silence without token', () => {
    expect(shouldSilence('Hello')).toBe(false);
  });

  it('does not silence long substantive replies with token', () => {
    const long = `${HEARTBEAT_OK} ${'x'.repeat(400)}`;
    expect(shouldSilence(long, 300)).toBe(false);
  });
});

describe('NO_REPLY', () => {
  it('is stable sentinel', () => {
    expect(NO_REPLY).toBe('NO_REPLY');
  });
});
