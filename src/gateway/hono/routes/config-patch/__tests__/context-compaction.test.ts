import { describe, expect, it } from 'vitest';

import type { Config } from '../../../../../config/schema.js';
import { applyMiscPatch } from '../misc.js';

function baseConfig(): Config {
  return {
    gateway: { port: 18790, corsOrigins: [] },
    agents: { default: 'main', capabilityPresets: {}, list: [] },
    channels: {},
  } as unknown as Config;
}

describe('applyMiscPatch context compaction', () => {
  it('replaces the strict global compaction policy while preserving memory siblings', async () => {
    const config = baseConfig();
    config.userContext = {
      memory: {
        mode: 'readOnly',
        sources: ['session'],
        retention: {
          maxItems: 100,
          compaction: {
            enabled: true,
            triggerThreshold: 0.8,
            reserveTokens: 8_192,
            minMessagesBeforeCompact: 10,
            keepRecentTokens: 20_000,
            recentTurnsPreserve: 3,
            summaryMaxTokens: 2_000,
            summaryChunkTokens: 24_000,
            summaryTimeoutMs: 180_000,
            summaryRetries: 2,
            qualityGuard: true,
            model: 'openai/old-model',
            minToolResultKeepChars: 1_000,
            maxActiveTranscriptBytes: 2_000_000,
            postCompactionSections: ['Session Startup'],
          },
        },
      },
    } as Config['userContext'];

    const result = await applyMiscPatch(config, {
      userContext: {
        memory: {
          retention: {
            compaction: {
              enabled: false,
              triggerThreshold: 0.72,
              reserveTokens: 12_000,
              minMessagesBeforeCompact: 6,
              keepRecentTokens: 32_000,
              recentTurnsPreserve: 5,
              summaryMaxTokens: 3_000,
              summaryChunkTokens: 18_000,
              summaryTimeoutMs: 90_000,
              summaryRetries: 4,
              qualityGuard: false,
              minToolResultKeepChars: 2_000,
              maxActiveTranscriptBytes: 4_000_000,
              postCompactionSections: ['Red Lines'],
            },
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(config.userContext?.memory.retention?.maxItems).toBe(100);
    expect(config.userContext?.memory.retention?.compaction).toMatchObject({
      enabled: false,
      triggerThreshold: 0.72,
      summaryRetries: 4,
      postCompactionSections: ['Red Lines'],
    });
    expect(config.userContext?.memory.retention?.compaction.model).toBeUndefined();
  });

  it('rejects legacy scalar compaction patches', async () => {
    const config = baseConfig();
    const result = await applyMiscPatch(config, {
      userContext: { memory: { retention: { compaction: true } } },
    });

    expect(result.ok).toBe(false);
    expect(config.userContext).toBeUndefined();
  });
});
