import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ConfigSchema } from '../../../config/schema.js';
import {
  assertDownloadUrlAllowed,
  downloadSkillZipBuffer,
  resolveSkillsStoreBaseUrl,
  skillIdForMarketplaceInstall,
} from '../marketplace/adapters/store/store-api-client.js';

describe('store-api-client (xopc Store HTTP)', () => {
  const storeBase = 'https://store.xopc.ai';

  describe('assertDownloadUrlAllowed', () => {
    it('allows HTTPS URLs on the same host as the store base', () => {
      const u = assertDownloadUrlAllowed('https://store.xopc.ai/files/x/y.zip', storeBase);
      expect(u.hostname).toBe('store.xopc.ai');
    });

    it('rejects HTTP', () => {
      expect(() =>
        assertDownloadUrlAllowed('http://store.xopc.ai/files/x.zip', storeBase),
      ).toThrow(/HTTPS/);
    });

    it('rejects a different host (SSRF guard)', () => {
      expect(() =>
        assertDownloadUrlAllowed('https://evil.example/x.zip', storeBase),
      ).toThrow(/host/);
    });
  });

  describe('resolveSkillsStoreBaseUrl', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('uses XOPC_SKILLS_STORE_URL when set', () => {
      vi.stubEnv('XOPC_SKILLS_STORE_URL', 'https://custom-store.example/path/');
      const cfg = ConfigSchema.parse({});
      expect(resolveSkillsStoreBaseUrl(cfg)).toBe('https://custom-store.example/path');
    });

    it('falls back to config gateway.skillsStoreBaseUrl', () => {
      const cfg = ConfigSchema.parse({
        gateway: { skillsStoreBaseUrl: 'https://cfg.example/' },
      });
      expect(resolveSkillsStoreBaseUrl(cfg)).toBe('https://cfg.example');
    });
  });

  describe('skillIdForMarketplaceInstall', () => {
    it('returns id when valid', () => {
      expect(skillIdForMarketplaceInstall('my-skill')).toBe('my-skill');
    });

    it('returns undefined for invalid ids', () => {
      expect(skillIdForMarketplaceInstall('bad id')).toBeUndefined();
    });
  });

  describe('downloadSkillZipBuffer', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          const buf = Buffer.from('tiny');
          return new Response(buf, {
            status: 200,
            headers: { 'content-length': String(buf.length) },
          });
        }),
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('downloads when URL is allowed', async () => {
      const buf = await downloadSkillZipBuffer(
        storeBase,
        'https://store.xopc.ai/files/a.zip',
      );
      expect(buf.equals(Buffer.from('tiny'))).toBe(true);
    });
  });
});
