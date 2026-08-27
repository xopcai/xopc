import { describe, expect, it, vi } from 'vitest';

import {
  ConfigSchema,
  getAgentDefaultModelRef,
} from '../../../../config/schema.js';
import {
  refreshOnboardModelCatalogIfNeeded,
  setPrimaryModel,
} from '../model.js';

describe('refreshOnboardModelCatalogIfNeeded', () => {
  it('loads the XOPC Cloud catalog when the local catalog is empty', async () => {
    const refresh = vi.fn(async () => ({
      state: 'ready' as const,
      source: 'network' as const,
      modelCount: 2,
    }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await refreshOnboardModelCatalogIfNeeded('xopc-cloud', false, { refresh });

    expect(refresh).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it('keeps a usable cached XOPC Cloud catalog without a network refresh', async () => {
    const refresh = vi.fn();

    await refreshOnboardModelCatalogIfNeeded('xopc-cloud', true, { refresh });

    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not refresh catalog-backed providers other than XOPC Cloud', async () => {
    const refresh = vi.fn();

    await refreshOnboardModelCatalogIfNeeded('openai', false, { refresh });

    expect(refresh).not.toHaveBeenCalled();
  });

  it('reports missing credentials instead of continuing with an empty catalog', async () => {
    const refresh = vi.fn(async () => ({ state: 'not-authorized' as const, source: 'none' as const, modelCount: 0 }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      refreshOnboardModelCatalogIfNeeded('xopc-cloud', false, { refresh }),
    ).rejects.toThrow('credentials are unavailable after OAuth login');
    log.mockRestore();
  });
});

describe('XOPC Cloud onboard defaults', () => {
  it('persists only the selected chat model', () => {
    const config = ConfigSchema.parse({});
    const updated = setPrimaryModel(config, '/tmp/xopc-main', 'xopc-cloud/chat-model');

    expect(getAgentDefaultModelRef(updated)).toBe('xopc-cloud/chat-model');
    expect(updated.agents.capabilityPresets.default?.models?.imageModel).toBeUndefined();
    expect(updated.agents.capabilityPresets.default?.models?.imageGenerationModel).toBeUndefined();
    expect(updated.tools.media?.audio).toBeUndefined();
    expect(updated.messages?.tts).toBeUndefined();
  });

  it('preserves existing explicit modality settings', () => {
    const config = ConfigSchema.parse({
      tools: { media: { audio: { enabled: true, provider: 'xopc-local' } } },
      messages: { tts: { enabled: true, provider: 'edge', trigger: 'inbound' } },
    });
    const updated = setPrimaryModel(config, '/tmp/xopc-main', 'xopc-cloud/chat-model');
    expect(updated.tools.media?.audio?.provider).toBe('xopc-local');
    expect(updated.messages?.tts?.provider).toBe('edge');
  });
});
