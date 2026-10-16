import { describe, expect, it, vi } from 'vitest';
import { assertProviderUsage, getModelUsageOrigin, modelUsageOriginFromTurn, modelUsageOriginForCall, withModelUsageOrigin } from '../model-usage.js';
import { wrapStreamFnForXopcExtensions } from '../../agent/embedded/xopc-stream-bridge.js';

describe('provider usage scope', () => {
  it.each(['xiaomi-token-plan-cn', 'kimi-coding'])('allows unknown and background calls for %s', provider => {
    expect(() => assertProviderUsage(provider)).not.toThrow();
    expect(() => withModelUsageOrigin('background', () => assertProviderUsage(provider))).not.toThrow();
    expect(() => withModelUsageOrigin('interactive', () => assertProviderUsage(provider))).not.toThrow();
  });
  it.each(['qwen-token-plan-cn', 'qwen-token-plan', 'qwen-token-plan-individual', 'QWEN-TOKEN-PLAN-CN'])('allows Bailian %s in background and unknown scopes', provider => {
    expect(() => assertProviderUsage(provider)).not.toThrow();
    expect(() => withModelUsageOrigin('background', () => assertProviderUsage(provider))).not.toThrow();
  });
  it.each(['token-plan.cn-beijing.maas.aliyuncs.com', 'token-plan.ap-southeast-1.maas.aliyuncs.com', 'coding.dashscope.aliyuncs.com', 'coding-intl.dashscope.aliyuncs.com'])('allows a Bailian endpoint alias at %s', hostname => {
    expect(() => withModelUsageOrigin('background', () => assertProviderUsage('custom', `https://${hostname}./v1`))).not.toThrow();
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
  it('keeps usage attribution for nested user, scheduled and automatic calls', () => {
    withModelUsageOrigin('background', () => withModelUsageOrigin(modelUsageOriginForCall({ operation: 'test', trigger: 'user' }), () => expect(getModelUsageOrigin()).toBe('background')));
    withModelUsageOrigin('interactive', () => withModelUsageOrigin(modelUsageOriginForCall({ operation: 'test', trigger: 'scheduled' }), () => expect(getModelUsageOrigin()).toBe('background')));
    expect(withModelUsageOrigin('interactive', () => modelUsageOriginForCall({ operation: 'session.generate_title' }))).toBe('background');
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
  it.each(['https://token-plan-cn.xiaomimimo.com/v1', 'https://token-plan-ams.xiaomimimo.com/v1', 'https://ark.cn-beijing.volces.com/api/coding/', 'https://ark.ap-southeast.bytepluses.com/api/coding/'])('allows subscription endpoint aliases at %s', url => {
    expect(() => assertProviderUsage('custom-alias', url)).not.toThrow();
    expect(() => withModelUsageOrigin('background', () => assertProviderUsage('custom-alias', url))).not.toThrow();
  });
  it('forwards background subscription streaming to the underlying transport', () => {
    const transport = vi.fn().mockReturnValue({ marker: 'transport' });
    const stream = wrapStreamFnForXopcExtensions(transport);
    expect(withModelUsageOrigin('background', () => stream({ provider: 'xiaomi-token-plan-cn', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1' } as never, { messages: [] } as never))).toEqual({ marker: 'transport' });
    expect(transport).toHaveBeenCalledOnce();
  });
});
