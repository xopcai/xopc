import { describe, expect, it } from 'vitest';

import { resolveModelEntries } from '../resolve-entries.js';
import '../../voice/stt/providers/index.js';

describe('resolveModelEntries', () => {
  it('returns capability-local entries in order', () => {
    const entries = resolveModelEntries({
      capability: 'audio',
      capabilityModels: [
        { provider: 'openai', model: 'whisper-1' },
        { provider: 'alibaba', model: 'paraformer-v2' },
      ],
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]?.provider).toBe('openai');
  });

  it('filters shared entries without capabilities', () => {
    const entries = resolveModelEntries({
      capability: 'audio',
      sharedModels: [{ provider: 'openai', model: 'whisper-1' }],
    });
    expect(entries).toEqual([]);
  });

  it('keeps shared entries that declare audio capability', () => {
    const entries = resolveModelEntries({
      capability: 'audio',
      sharedModels: [{ provider: 'openai', model: 'whisper-1', capabilities: ['audio'] }],
    });
    expect(entries).toHaveLength(1);
  });

  it('skips cli entries', () => {
    const entries = resolveModelEntries({
      capability: 'audio',
      capabilityModels: [{ type: 'cli', command: 'whisper-cli' }],
    });
    expect(entries).toEqual([]);
  });
});
