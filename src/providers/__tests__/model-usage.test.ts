import { completeWithResolvedCredentials } from '../model-call.js';
import { describe, expect, it, vi } from 'vitest';
import { assertProviderUsage, getModelUsageOrigin, modelUsageOriginFromTurn, ProviderUsageScopeError, withModelUsageOrigin } from '../model-usage.js';
import { wrapStreamFnForXopcExtensions } from '../../agent/embedded/xopc-stream-bridge.js';
import { fetchWithTimeoutGuarded } from '../../media-shared/http/provider-http.js';

describe('provider usage scope', () => {
  it.each(['qwen-token-plan-cn', 'xiaomi-token-plan-cn'])('blocks unknown and background calls for %s', provider => {
    expect(() => assertProviderUsage(provider)).toThrow(ProviderUsageScopeError);
    expect(() => withModelUsageOrigin('background', () => assertProviderUsage(provider))).toThrow(ProviderUsageScopeError);
    expect(() => withModelUsageOrigin('interactive', () => assertProviderUsage(provider))).not.toThrow();
  });
  it('keeps Cloud and ordinary API background calls available', () => {
    expect(() => withModelUsageOrigin('background', () => { assertProviderUsage('xopc-cloud'); assertProviderUsage('openai'); })).not.toThrow();
  });
  it('propagates concurrent child scopes without allowing a child to upgrade its parent', async () => {
    await Promise.all([
      withModelUsageOrigin('background', async () => { await Promise.resolve(); withModelUsageOrigin('interactive', () => expect(getModelUsageOrigin()).toBe('background')); }),
      withModelUsageOrigin('interactive', async () => { await Promise.resolve(); expect(getModelUsageOrigin()).toBe('interactive'); }),
    ]);
    expect(getModelUsageOrigin()).toBe('unknown');
  });
  it('does not let one-shot user telemetry upgrade a background task or a scheduled call inherit user scope', async () => {
    const model = { provider: 'qwen-token-plan-cn', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' } as never;
    await expect(withModelUsageOrigin('background', () => completeWithResolvedCredentials(model, {} as never, {}, undefined, { operation: 'test', trigger: 'user' }))).rejects.toThrow(ProviderUsageScopeError);
    await expect(withModelUsageOrigin('interactive', () => completeWithResolvedCredentials(model, {} as never, {}, undefined, { operation: 'test', trigger: 'scheduled' }))).rejects.toThrow(ProviderUsageScopeError);
    await expect(withModelUsageOrigin('interactive', () => completeWithResolvedCredentials(model, {} as never, {}, undefined, { operation: 'session.generate_title' }))).rejects.toThrow(ProviderUsageScopeError);
  });

  it('lets synchronous workflow children inherit the user scope, while an independent workflow is background', () => {
    const origin = { type: 'system', source: 'workflow' } as const;
    expect(modelUsageOriginFromTurn(origin)).toBe('background');
    expect(withModelUsageOrigin('interactive', () => modelUsageOriginFromTurn(origin))).toBe('interactive');
    expect(withModelUsageOrigin('background', () => modelUsageOriginFromTurn(origin))).toBe('background');
  });

  it('classifies host origins, including user CLI and scheduled automation', () => {
    expect(modelUsageOriginFromTurn({ type: 'system', source: 'cli' })).toBe('interactive');
    expect(modelUsageOriginFromTurn({ type: 'system', source: 'automation' })).toBe('background');
    expect(modelUsageOriginFromTurn({ type: 'endpoint', endpointId: 'browser' })).toBe('interactive');
  });
  it('blocks aliases and media endpoints before network access', async () => {
    await expect(fetchWithTimeoutGuarded('https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer', { timeoutMs: 1000, label: 'test' })).rejects.toThrow(ProviderUsageScopeError);
    expect(() => assertProviderUsage('custom-alias', 'https://token-plan-cn.xiaomimimo.com/v1')).toThrow(ProviderUsageScopeError);
    expect(() => assertProviderUsage('QWEN-TOKEN-PLAN-CN')).toThrow(ProviderUsageScopeError);
    expect(() => assertProviderUsage('custom-alias', 'https://token-plan.cn-beijing.maas.aliyuncs.com./v1')).toThrow(ProviderUsageScopeError);
  });
  it('rejects pi embedded streaming before the underlying transport is invoked', () => {
    const transport = vi.fn();
    const stream = wrapStreamFnForXopcExtensions(transport);
    expect(() => stream({ provider: 'qwen-token-plan-cn', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' } as never, {} as never)).toThrow(ProviderUsageScopeError);
    expect(transport).not.toHaveBeenCalled();
  });
});
