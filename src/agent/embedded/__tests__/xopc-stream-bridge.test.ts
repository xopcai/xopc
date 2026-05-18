import { describe, expect, it, vi, afterEach } from 'vitest';
import type { Model, Api, Context } from '@earendil-works/pi-ai';

import { wrapStreamFnForXopcExtensions } from '../xopc-stream-bridge.js';
import {
  ProviderPluginRegistry,
  setProviderRegistry,
  getProviderRegistry,
} from '../../../providers/plugin-registry.js';
import { EXTENSION_PROVIDER_BASE_URL } from '../../../providers/index.js';
import type { ProviderPlugin } from '../../../extensions/types/providers.js';

const FAKE_CONTEXT = { messages: [] } as unknown as Context;

function makeBuiltinModel(): Model<Api> {
  return {
    provider: 'openai',
    id: 'gpt-4o',
    api: 'openai-completions',
    baseUrl: 'https://api.openai.com/v1',
  } as unknown as Model<Api>;
}

function makeExtensionModel(providerId: string): Model<Api> {
  return {
    provider: providerId,
    id: 'demo-model',
    api: 'openai-completions',
    baseUrl: EXTENSION_PROVIDER_BASE_URL,
  } as unknown as Model<Api>;
}

describe('wrapStreamFnForXopcExtensions', () => {
  afterEach(() => {
    setProviderRegistry(new ProviderPluginRegistry());
  });

  it('delegates non-extension models to the original streamFn untouched', () => {
    const original = vi.fn(() => ({}) as never);
    const wrapped = wrapStreamFnForXopcExtensions(original as never);
    const model = makeBuiltinModel();

    wrapped(model, FAKE_CONTEXT, undefined);

    expect(original).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledWith(model, FAKE_CONTEXT, undefined);
  });

  it('routes extension models through the plugin registry, bypassing the original streamFn', () => {
    const fakePlugin: ProviderPlugin = {
      id: 'demo',
      name: 'Demo Provider',
      models: [{ id: 'demo-model', name: 'Demo' }],
      // eslint-disable-next-line require-yield
      createStream: vi.fn(async function* () {
        return;
      }) as never,
    } as ProviderPlugin;
    getProviderRegistry().register(fakePlugin);

    const original = vi.fn(() => ({}) as never);
    const wrapped = wrapStreamFnForXopcExtensions(original as never);

    wrapped(makeExtensionModel('demo'), FAKE_CONTEXT, undefined);

    expect(original).not.toHaveBeenCalled();
    expect(fakePlugin.createStream).toHaveBeenCalledTimes(1);
  });

});
