import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { computerModelProfile, isDedicatedComputerModel } from '../../computer/model-policy.js';
import { ModelCatalogStore } from '../model-catalog-store.js';
import { ModelRegistry } from '../model-registry.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('discovers custom visual tool models and preserves explicit tool exclusions and overrides', () => {
  const root = mkdtempSync(join(tmpdir(), 'xopc-computer-models-'));
  roots.push(root);
  const path = join(root, 'models.json');
  writeFileSync(path, JSON.stringify({ providers: {
    proxy: { api: 'openai-completions', baseUrl: 'https://proxy.test/v1', models: [
      { id: 'arbitrary-vision', input: ['text', 'image'], supportsTools: true },
      { id: 'responses-vision', api: 'openai-responses', input: ['text', 'image'] },
      { id: 'vision-without-tools', input: ['text', 'image'], supportsTools: false },
      { id: 'text-only', input: ['text'] },
    ] },
    openai: { modelOverrides: { 'gpt-6-astra': { supportsTools: false } } },
  } }));
  const registry = new ModelRegistry(path, new ModelCatalogStore());
  for (const id of ['arbitrary-vision', 'responses-vision']) {
    const model = registry.resolve(`proxy/${id}`);
    expect(computerModelProfile(model)).toBe('structured-tools-v1');
    expect(isDedicatedComputerModel(model)).toBe(false);
  }
  expect(registry.getError()).toBeUndefined();
  for (const ref of ['proxy/vision-without-tools', 'proxy/text-only', 'openai/gpt-6-astra']) {
    expect(computerModelProfile(registry.resolve(ref))).toBeUndefined();
  }
});
