import { describe, expect, it } from 'vitest';

import { COMPOSER_VOICE_CALL_OPTIONS } from '../composer-voice-call-options';

describe('composer voice call options', () => {
  it('maps the no-tools entry to omni and the tools entry to agent', () => {
    expect(COMPOSER_VOICE_CALL_OPTIONS.map(({ key, engine }) => ({ key, engine }))).toEqual([
      { key: 'voice-no-tools', engine: 'omni' },
      { key: 'voice-with-tools', engine: 'agent' },
    ]);
  });
});
