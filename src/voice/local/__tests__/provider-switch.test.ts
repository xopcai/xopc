import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../../config/schema.js';
import { localVoiceModelForProviderSwitch } from '../provider-switch.js';

describe('local voice provider switch', () => {
  it('selects the configured model when STT changes from Cloud to local', () => {
    const config = ConfigSchema.parse({
      tools: {
        media: {
          audio: {
            enabled: true,
            provider: 'xopc-local',
            providers: { 'xopc-local': { model: 'small' } },
          },
        },
      },
    });

    expect(localVoiceModelForProviderSwitch('xopc-cloud', config)).toBe('small');
  });

  it('does not download again when local was already selected', () => {
    const config = ConfigSchema.parse({
      tools: { media: { audio: { provider: 'xopc-local' } } },
    });

    expect(localVoiceModelForProviderSwitch('xopc-local', config)).toBeNull();
    expect(localVoiceModelForProviderSwitch(undefined, config)).toBeNull();
  });

  it('does not download when local STT is disabled or no longer selected', () => {
    const disabled = ConfigSchema.parse({
      tools: { media: { audio: { enabled: false, provider: 'xopc-local' } } },
    });
    const cloud = ConfigSchema.parse({
      tools: { media: { audio: { provider: 'xopc-cloud' } } },
    });

    expect(localVoiceModelForProviderSwitch('xopc-cloud', disabled)).toBeNull();
    expect(localVoiceModelForProviderSwitch('openai', cloud)).toBeNull();
  });
});
