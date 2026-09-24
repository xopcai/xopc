import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMPUTER_DESCRIPTOR } from '@xopcai/computer-control-contract';
import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { closeXopcDatabase } from '../../storage/sqlite/index.js';
import { EndpointToolPolicy } from '../../endpoint-tools/policy.js';
import { resolveEffectiveAgentConfig } from '../../agent-config/resolver.js';
import { ChatCompletionsComputerAdapter, readComputerJson } from '../model-adapter.js';

describe('computer configuration and protocol boundaries', () => {
  beforeAll(() => initializeTestAgentCatalog());
  afterAll(() => closeXopcDatabase());

  it('registers the exact desktop-only private transport contract', () => {
    const policy = new EndpointToolPolicy();
    expect(() => policy.validateDescriptor('desktop', structuredClone(COMPUTER_DESCRIPTOR) as any)).not.toThrow();
    expect(() => policy.validateDescriptor('web', structuredClone(COMPUTER_DESCRIPTOR) as any)).toThrow();
    expect(() => policy.validateDescriptor('desktop', { ...structuredClone(COMPUTER_DESCRIPTOR), confirmation: 'always' } as any)).toThrow();
  });
  it('inherits the specialized model and treats a null override as global inheritance', () => {
    const defaults = new AgentCatalogRepository().snapshot().defaults;
    defaults.models.computerUse = { primary: 'dashscope-cn/gui-plus-2026-02-26', fallbacks: [] };
    const inherited = resolveEffectiveAgentConfig({ defaults, agent: { id: 'main', enabled: true } });
    expect(inherited.config.models.computerUse?.primary).toBe('dashscope-cn/gui-plus-2026-02-26');
    const cleared = resolveEffectiveAgentConfig({ defaults, agent: { id: 'main', enabled: true, models: { computerUse: null } } });
    expect(cleared.config.models.computerUse).toEqual(defaults.models.computerUse);
    expect(cleared.config.models.chat).toEqual(defaults.models.chat);
  });
  it('bounds streamed catalogs and never accepts authority overrides', async () => {
    await expect(readComputerJson(new Response('x'.repeat(101)), 100)).rejects.toThrow('RESPONSE_LIMIT');
    expect(() => new ChatCompletionsComputerAdapter({ modelId: 'fixture', baseUrl: 'https://model.test/v1', apiKey: 'fixture',
      profile: 'structured-tools-v1', headers: { Host: 'other.test' } })).toThrow('UNSUPPORTED_MODEL_HEADER');
  });
});
