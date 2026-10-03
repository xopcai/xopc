import { describe, expect, it } from 'vitest';

import { xopcVoiceShouldReconnect } from '../entry/src/main/ets/common/voiceRecovery.ets';

describe('Harmony realtime voice recovery policy', () => {
  it.each(['NETWORK', 'OMNI_CONNECTION_CLOSED', 'OMNI_CONNECTION_FAILED'])(
    'reconnects after transient failure %s', (reason) => {
      expect(xopcVoiceShouldReconnect(reason)).toBe(true);
    });

  it.each(['OMNI_CONNECTION_REJECTED', 'OMNI_PROVIDER_ERROR', 'INVALID_AUDIO'])(
    'keeps permanent failure %s paused for user action', (reason) => {
      expect(xopcVoiceShouldReconnect(reason)).toBe(false);
    });
});
