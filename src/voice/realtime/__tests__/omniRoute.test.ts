import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../../config/schema.js';
import { resolveOmniRoute } from '../omniRoute.js';

describe('shared native voice credentials', () => {
  it('uses the shared input credential unless an explicit native override is configured', async () => {
    const config = ConfigSchema.parse({
      voice: { realtime: { enabled: true, omni: { provider: 'alibaba', model: 'qwen3-omni-flash-realtime', voice: 'Cherry' } } },
      tools: { media: { audio: { providers: { alibaba: { apiKey: 'shared-test-key' } } } } },
    });
    expect((await resolveOmniRoute(config)).apiKey).toBe('shared-test-key');
    config.voice!.realtime!.omni!.apiKey = 'explicit-test-key';
    expect((await resolveOmniRoute(config)).apiKey).toBe('explicit-test-key');
  });
});
