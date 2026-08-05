import { describe, expect, it } from 'vitest';

import {
  buildContextCompactionPatch,
  DEFAULT_CONTEXT_COMPACTION_CONFIG,
  normalizeContextCompactionFromConfig,
  validateContextCompactionConfig,
} from '../context-compaction-config-api';

describe('normalizeContextCompactionFromConfig', () => {
  it('reads every strict compaction field', () => {
    const result = normalizeContextCompactionFromConfig({
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
              model: 'openai/gpt-5',
              minToolResultKeepChars: 2_000,
              maxActiveTranscriptBytes: 4_000_000,
              postCompactionSections: ['Session Startup', 'Safety'],
            },
          },
        },
      },
    });

    expect(result).toEqual({
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
      model: 'openai/gpt-5',
      minToolResultKeepChars: 2_000,
      maxActiveTranscriptBytes: 4_000_000,
      postCompactionSections: ['Session Startup', 'Safety'],
    });
  });

  it('uses current defaults when the object is absent or uses a legacy scalar', () => {
    expect(normalizeContextCompactionFromConfig({})).toEqual(DEFAULT_CONTEXT_COMPACTION_CONFIG);
    expect(normalizeContextCompactionFromConfig({
      userContext: { memory: { retention: { compaction: true } } },
    })).toEqual(DEFAULT_CONTEXT_COMPACTION_CONFIG);
  });
});

describe('buildContextCompactionPatch', () => {
  it('writes only the strict global compaction object and omits an inherited model', () => {
    const patch = buildContextCompactionPatch({
      ...DEFAULT_CONTEXT_COMPACTION_CONFIG,
      model: undefined,
    });

    expect(patch).toEqual({
      userContext: {
        memory: {
          retention: {
            compaction: DEFAULT_CONTEXT_COMPACTION_CONFIG,
          },
        },
      },
    });
  });
});

describe('validateContextCompactionConfig', () => {
  it('accepts the defaults', () => {
    expect(validateContextCompactionConfig(DEFAULT_CONTEXT_COMPACTION_CONFIG)).toBeNull();
  });

  it('reports the first invalid field', () => {
    expect(validateContextCompactionConfig({
      ...DEFAULT_CONTEXT_COMPACTION_CONFIG,
      summaryRetries: 6,
    })).toBe('summaryRetries');
  });
});
