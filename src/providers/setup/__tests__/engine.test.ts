import { describe, expect, it } from 'vitest';
import { AgentDefaultsSchema } from '../../../agent-config/index.js';
import { getModelsByProvider } from '../../index.js';
import { getProviderSetupProfile } from '../profiles.js';
import { applyProviderSetup, previewProviderSetup, SetupConflictError, type SetupSnapshot } from '../engine.js';

function snapshot(provider: string): SetupSnapshot {
  const cloud = [{ ref: 'xopc-cloud/auto', name: 'Standard', vision: true, recommended: true, reasoning: true }, { ref: 'xopc-cloud/advanced', name: 'Advanced', vision: true, reasoning: true }];
  return {
    profile: getProviderSetupProfile(provider),
    defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: 'existing/chat', fallbacks: ['paid/backup'] }, imageUnderstanding: { primary: 'existing/vision' }, intents: { understanding: { primary: 'existing/background' } } } }),
    configured: true, configuredProviders: new Set(['existing', provider]),
    models: provider === 'xopc-cloud' ? cloud : getModelsByProvider(provider).map(model => ({ ref: `${provider}/${model.id}`, name: model.name, vision: model.input.includes('image'), reasoning: model.reasoning })),
    images: provider === 'qwen-token-plan-cn' ? [{ ref: `${provider}/qwen-image-3.0-pro`, name: 'Qwen Image' }] : provider === 'xopc-cloud' ? [{ ref: 'xopc-cloud/image', name: 'Cloud Image' }] : [],
  };
}
describe('shared model setup', () => {
  it.each(['qwen-token-plan-cn', 'xopc-cloud', 'xiaomi-token-plan-cn'])('previews and applies %s through the same engine', provider => {
    const data = snapshot(provider);
    const preview = previewProviderSetup(data, { mode: 'replace' });
    expect(data.models.length).toBeGreaterThan(0);
    expect(preview.uses.find(use => use.id === 'chat')?.recommended).toMatch(new RegExp(`^${provider}/`));
    const result = applyProviderSetup(data, { mode: 'replace', selected: preview.uses.filter(use => use.selected).map(use => use.id) }, preview.revision);
    expect(result.defaults.models.chat.primary).toMatch(new RegExp(`^${provider}/`));
    expect(result.defaults.models.chat.fallbacks).toEqual([]);
    expect(result.defaults.models.intents.understanding).toEqual(data.defaults.models.intents.understanding);
    if (data.profile.interactiveOnly) expect(result.defaults.models.background).toBeUndefined();
  });
  it('fills missing uses and retains an existing usable chat and vision route', () => {
    const data = snapshot('qwen-token-plan-cn');
    const preview = previewProviderSetup(data);
    expect(preview.uses.filter(use => use.selected).map(use => use.id)).toEqual(['image']);
    const result = applyProviderSetup(data, {}, preview.revision);
    expect(result.defaults.models.chat).toEqual(data.defaults.models.chat);
    expect(result.defaults.models.imageGeneration?.primary).toBe('qwen-token-plan-cn/qwen-image-3.0-pro');
  });
  it('treats an unconnected installation default as missing', () => {
    const data = snapshot('qwen-token-plan-cn'); data.configuredProviders.delete('existing');
    expect(previewProviderSetup(data).uses.find(use => use.id === 'chat')?.selected).toBe(true);
  });
  it('retains an existing subscription background route when filling other uses', () => {
    const data = snapshot('xopc-cloud');
    data.defaults.models.background = { primary: 'xiaomi-token-plan-cn/mimo-v2.5', fallbacks: [] };
    data.configuredProviders.add('xiaomi-token-plan-cn');
    const preview = previewProviderSetup(data);
    expect(preview.uses.find(use => use.id === 'background')?.selected).toBe(false);
    expect(applyProviderSetup(data, {}, preview.revision).defaults.models.background?.primary).toBe('xiaomi-token-plan-cn/mimo-v2.5');
  });
  it('preserves configured task intents when filling a missing chat route', () => {
    const data = snapshot('qwen-token-plan-cn');
    data.defaults.models.chat.primary = 'missing/chat';
    data.defaults.models.intents.coding = { primary: 'existing/code', fallbacks: [] };
    const result = applyProviderSetup(data, {}, previewProviderSetup(data).revision);
    expect(result.defaults.models.chat.primary).toBe('qwen-token-plan-cn/qwen3.8-flash');
    expect(result.defaults.models.intents.coding?.primary).toBe('existing/code');
  });
  it('rejects stale previews, foreign overrides and unsupported background selection', () => {
    const data = snapshot('qwen-token-plan-cn'); const revision = previewProviderSetup(data).revision;
    data.defaults.runtime.maxTurns = 42;
    expect(() => applyProviderSetup(data, {}, revision)).toThrow(SetupConflictError);
    expect(() => previewProviderSetup(data, { overrides: { vision: 'other/text-only' } })).toThrow('Invalid vision');
    const restricted = snapshot('custom'); restricted.models = [];
    expect(() => applyProviderSetup(restricted, { selected: ['background'] }, previewProviderSetup(restricted).revision)).toThrow('No eligible');
  });
  it('does not guess a model from array order and allows explicit model selection', () => {
    const data = snapshot('custom'); data.models = [{ ref: 'custom/one', name: 'One' }, { ref: 'custom/two', name: 'Two' }];
    expect(previewProviderSetup(data).uses.find(use => use.id === 'chat')?.reason).toBe('no_recommendation');
    const request = { selected: ['chat' as const], overrides: { chat: 'custom/two' } };
    expect(applyProviderSetup(data, request, previewProviderSetup(data, request).revision).defaults.models.chat.primary).toBe('custom/two');
  });
  it('requires a saved connection and keeps recommendations stable when credentials are saved', () => {
    const data = snapshot('qwen-token-plan-cn'); data.configured = false;
    const revision = previewProviderSetup(data).revision;
    expect(() => applyProviderSetup(data, {}, revision)).toThrow('Connect');
    data.configured = true; data.configuredProviders.add('newly-connected');
    expect(previewProviderSetup(data).revision).toBe(revision);
  });
  it('includes subscription endpoint aliases in background choices and detects snapshot changes', () => {
    const data = snapshot('custom');
    data.models = [{ ref: 'custom/plan', name: 'Plan', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', recommended: true }, { ref: 'custom/api', name: 'API' }];
    const preview = previewProviderSetup(data);
    expect(preview.uses.find(use => use.id === 'background')?.choices).toEqual([{ id: 'custom/plan', name: 'Plan' }, { id: 'custom/api', name: 'API' }]);
    data.backgroundRestrictedModels = new Set(['existing/chat']);
    expect(previewProviderSetup(data).revision).not.toBe(preview.revision);
  });
});


it.each(['qwen-token-plan-cn', 'qwen-token-plan', 'qwen-token-plan-individual', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-sgp', 'zai-coding-cn', 'zai-coding-global', 'zhipu-coding-cn', 'kimi-coding', 'volcengine-plan', 'byteplus-plan', 'stepfun-plan', 'stepfun-plan-cn', 'stepfun-plan-intl'])('keeps %s as subscription access without interactive-only restrictions', provider => {
  expect(getProviderSetupProfile(provider)).toMatchObject({ access: 'subscription', interactiveOnly: false });
});
it('offers and applies Bailian background models without changing the chat route', () => {
  const data = snapshot('qwen-token-plan-cn');
  const request = { mode: 'replace' as const, selected: ['background' as const] };
  const preview = previewProviderSetup(data, request);
  expect(preview.uses.find(use => use.id === 'background')?.choices.length).toBeGreaterThan(0);
  const result = applyProviderSetup(data, request, preview.revision);
  expect(result.defaults.models.background?.primary).toBe('qwen-token-plan-cn/qwen3.8-flash');
  expect(result.defaults.models.chat).toEqual(data.defaults.models.chat);
});
