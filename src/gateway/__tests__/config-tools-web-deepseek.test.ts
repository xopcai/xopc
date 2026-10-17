import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { applyToolsWebPatch, safeToolsWebForGet } from '../config-tools-web.js';
import { applySearchProviderUpsert, applySearchProviderRemove } from '../../cli/commands/search.js';

describe('DeepSeek search configuration', () => {
  it('round trips CLI and Gateway configuration without exposing or losing keys', () => {
    let config = applySearchProviderUpsert(ConfigSchema.parse({}), { type: 'deepseek', apiKey: 'secret', url: 'https://proxy.example/v1' });
    const safe = safeToolsWebForGet(config);
    expect(JSON.stringify(safe)).not.toContain('secret');
    expect(applyToolsWebPatch(config, { tools: safe })).toBeUndefined();
    expect(config.tools?.web?.search?.providers[0]).toMatchObject({ type: 'deepseek', apiKey: 'secret', url: 'https://proxy.example/v1' });
    config = applySearchProviderRemove(config, 'deepseek');
    expect(config.tools?.web?.search?.providers).toEqual([]);
  });

  it('preserves secrets by type when rows are reordered and rejects cross-type masks', () => {
    const config = ConfigSchema.parse({ tools: { web: { search: { providers: [
      { type: 'brave', apiKey: 'brave-secret' }, { type: 'deepseek', apiKey: 'deepseek-secret' },
    ] } } } });
    const rows = safeToolsWebForGet(config).web.search.providers;
    expect(applyToolsWebPatch(config, { tools: { web: { search: { providers: [...rows].reverse() } } } })).toBeUndefined();
    expect(config.tools?.web?.search?.providers.map(row => row.apiKey)).toEqual(['deepseek-secret', 'brave-secret']);
    const changed = ConfigSchema.parse({ tools: { web: { search: { providers: [{ type: 'brave', apiKey: 'brave-secret' }] } } } });
    expect(applyToolsWebPatch(changed, { tools: { web: { search: { providers: [{ ...rows[0], type: 'deepseek' }] } } } })).toContain('Cannot preserve');
  });

  it('rejects unsafe endpoint shapes in Gateway patches', () => {
    const config = ConfigSchema.parse({});
    expect(applyToolsWebPatch(config, { tools: { web: { search: { providers: [
      { type: 'deepseek', apiKey: 'key', url: 'https://example.com?secret=value' },
    ] } } } })).toContain('Invalid DeepSeek');
  });
});
