import { describe, expect, it } from 'vitest';

import { PROVIDER_META } from '../../../providers/index.js';
import { listProviders, maskKey, planSetKey } from '../providers.js';

describe('xopc providers helpers', () => {
  describe('maskKey', () => {
    it('returns null for missing values', () => {
      expect(maskKey(undefined)).toBeNull();
    });

    it('fully masks short values', () => {
      expect(maskKey('abcd')).toBe('****');
    });

    it('keeps a glimpse of head and tail for longer values', () => {
      expect(maskKey('sk-1234567890')).toBe('sk-1…7890');
    });
  });

  describe('listProviders', () => {
    it('returns the known LLM providers from PROVIDER_META', () => {
      const entries = listProviders();
      const ids = entries.map((e) => e.id);
      expect(ids).toContain('openai');
      expect(ids).toContain('deepseek');
      expect(ids).toContain('anthropic');
    });

    it('marks every entry with a status from the closed set', () => {
      const valid = new Set(['configured', 'env-only', 'oauth', 'not-configured']);
      for (const entry of listProviders()) {
        expect(valid.has(entry.status)).toBe(true);
      }
    });

    it('attaches an env var hint for each provider', () => {
      for (const entry of listProviders()) {
        expect(entry.envVar).toMatch(/^[A-Z][A-Z0-9_]+$/);
      }
    });

    it('keeps provider display names free of model identifiers', () => {
      for (const meta of Object.values(PROVIDER_META)) {
        expect(meta.name).not.toMatch(/\b(?:gpt|GPT|claude|Claude|o\d+)\b|GPT-|gpt-/);
      }
    });
  });

  describe('planSetKey', () => {
    it('reports willChange=true when there is no existing profile', () => {
      const plan = planSetKey({
        provider: 'totally-new-provider',
        profileId: 'totally-new-provider:default',
        key: 'sk-new',
      });
      expect(plan.willChange).toBe(true);
      expect(plan.existing).toBeUndefined();
      expect(plan.next).toMatchObject({ type: 'api_key', provider: 'totally-new-provider' });
    });
  });
});
