import { describe, expect, it } from 'vitest';

import type { Config } from '../../../config/schema.js';
import { applyTTSEnable, readTTSStatus } from '../voice.js';
import {
  applySearchProviderRemove,
  applySearchProviderUpsert,
} from '../search.js';
import { SetupValidationError } from '../setup-shared/index.js';

describe('xopc voice helpers', () => {
  it('applyTTSEnable writes nested cfg.messages.tts', () => {
    const before = {} as Config;
    const after = applyTTSEnable(before, { enabled: true, provider: 'edge', trigger: 'inbound' });
    const tts = (after.messages as Record<string, Record<string, unknown>>).tts;
    expect(tts).toMatchObject({ enabled: true, provider: 'edge', trigger: 'inbound' });
  });

  it('applyTTSEnable preserves prior fields when toggling enabled', () => {
    const seeded = applyTTSEnable({} as Config, {
      enabled: true,
      provider: 'edge',
      trigger: 'inbound',
    });
    const after = applyTTSEnable(seeded, { enabled: false });
    const tts = (after.messages as Record<string, Record<string, unknown>>).tts;
    expect(tts).toMatchObject({ enabled: false, provider: 'edge', trigger: 'inbound' });
  });

  it('readTTSStatus returns sensible defaults when nothing is configured', () => {
    const status = readTTSStatus({} as Config);
    expect(status).toMatchObject({
      enabled: false,
      provider: 'openai',
      trigger: 'always',
    });
  });
});

describe('xopc search helpers', () => {
  it('applySearchProviderUpsert is idempotent on type', () => {
    const before = {} as Config;
    const a = applySearchProviderUpsert(before, { type: 'brave', apiKey: 'key1' });
    const b = applySearchProviderUpsert(a, { type: 'brave', apiKey: 'key2' });
    const list = (
      (b.tools as Record<string, Record<string, Record<string, unknown[]>>>).web.search.providers
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'brave', apiKey: 'key2' });
  });

  it('applySearchProviderUpsert preserves other entries', () => {
    let cfg = {} as Config;
    cfg = applySearchProviderUpsert(cfg, { type: 'brave', apiKey: 'k1' });
    cfg = applySearchProviderUpsert(cfg, { type: 'searxng', url: 'http://localhost:8080' });
    const list = (
      (cfg.tools as Record<string, Record<string, Record<string, unknown[]>>>).web.search.providers
    );
    expect(list).toHaveLength(2);
    const types = list.map((p: any) => p.type).sort();
    expect(types).toEqual(['brave', 'searxng']);
  });

  it('applySearchProviderRemove drops the matching type', () => {
    let cfg = {} as Config;
    cfg = applySearchProviderUpsert(cfg, { type: 'brave', apiKey: 'k1' });
    cfg = applySearchProviderUpsert(cfg, { type: 'tavily', apiKey: 'k2' });
    cfg = applySearchProviderRemove(cfg, 'brave');
    const list = (
      (cfg.tools as Record<string, Record<string, Record<string, unknown[]>>>).web.search.providers
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'tavily' });
  });

  it('applySearchProviderRemove throws when type is not configured', () => {
    expect(() => applySearchProviderRemove({} as Config, 'bing')).toThrow(SetupValidationError);
  });
});
