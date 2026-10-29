import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { isDedicatedPhoneModel, phoneModelProfile } from '../../phone/model-policy.js';
import { ModelCatalogStore } from '../model-catalog-store.js';
import { ModelRegistry } from '../model-registry.js';

it('discovers phone models from registry APIs, explicit protocols and per-model tool exclusions', () => {
  const root = mkdtempSync(join(tmpdir(), 'xopc-phone-models-'));
  try {
    const path = join(root, 'models.json');
    writeFileSync(path, JSON.stringify({ providers: {
      custom: { api: 'openai-completions', baseUrl: 'https://proxy.test/v1', models: [
        { id: 'visual', input: ['text', 'image'] },
        { id: 'responses', api: 'openai-responses', input: ['text', 'image'] },
        { id: 'explicit', api: 'openai-responses', input: ['text', 'image'], phoneUse: { profile: 'structured-tools-phone-v1' } },
        { id: 'no-tools', input: ['text', 'image'], supportsTools: false },
        { id: 'text', input: ['text'] },
      ] },
      openai: { modelOverrides: { 'gpt-6-astra': { supportsTools: false } } },
    } }));
    const registry = new ModelRegistry(path, new ModelCatalogStore());
    expect(registry.getError()).toBeUndefined();
    for (const ref of ['custom/visual', 'custom/responses', 'custom/explicit', 'openai/gpt-6.1-sol']) {
      const model = registry.resolve(ref);
      expect(phoneModelProfile(model), ref).toBe('structured-tools-phone-v1');
      expect(isDedicatedPhoneModel(model), ref).toBe(false);
    }
    for (const ref of ['custom/no-tools', 'custom/text', 'openai/gpt-6-astra']) expect(phoneModelProfile(registry.resolve(ref)), ref).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
