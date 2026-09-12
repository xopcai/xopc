import { describe, expect, it } from 'vitest';

import { COMPOSER_VOICE_CALL_OPTIONS, resolveComposerVoiceCallOption } from '../composer-voice-call-options';

describe('composer voice call options', () => {
  it('maps the call entries to product modes', () => {
    expect(COMPOSER_VOICE_CALL_OPTIONS.map(({ key, mode }) => ({ key, mode }))).toEqual([
      { key: 'voice-no-tools', mode: 'natural' },
      { key: 'voice-with-tools', mode: 'assistant' },
    ]);
  });

  it('resolves one composer entry from preferences and follows the gateway by default', () => {
    expect(resolveComposerVoiceCallOption().mode).toBe('natural');
    expect(resolveComposerVoiceCallOption('assistant').mode).toBe('assistant');
  });
});
