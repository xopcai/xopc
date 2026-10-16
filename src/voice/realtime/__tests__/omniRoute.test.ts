import { describe, expect, it, vi } from 'vitest';
const credentials = vi.hoisted(()=>vi.fn(async ()=>'plan-key'));
vi.mock('../../../providers/provider-auth-service.js',()=>({getProviderAuthService:()=>({resolveApiKey:credentials})}));

import { ConfigSchema } from '../../../config/schema.js';
import { resolveOmniRoute } from '../omniRoute.js';

describe('shared native voice credentials', () => {
  it('uses only the subscription credential and endpoint for subscription conversation', async () => {
    const route = await resolveOmniRoute(ConfigSchema.parse({voice:{realtime:{omni:{provider:'qwen-token-plan-cn',model:'qwen-audio-3.0-realtime-plus',voice:'longanqian',apiKey:'wrong-key',baseUrl:'wss://dashscope.aliyuncs.com/api-ws/v1/realtime'}}}}));
    expect(route.url).toBe('wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-plus');
    expect(route.apiKey).toBe('plan-key');
    expect(credentials).toHaveBeenCalledWith('qwen-token-plan-cn');
  });
  it('uses the shared input credential unless an explicit native override is configured', async () => {
    const config = ConfigSchema.parse({
      voice: { realtime: { enabled: true, omni: { provider: 'alibaba', model: 'qwen3-omni-flash-realtime', voice: 'Cherry' } } },
      tools: { media: { audio: { providers: { alibaba: { apiKey: 'shared-test-key' } } } } },
    });
    expect((await resolveOmniRoute(config)).apiKey).toBe('shared-test-key');
    config.voice!.realtime!.omni!.apiKey = 'explicit-test-key';
    expect((await resolveOmniRoute(config)).apiKey).toBe('explicit-test-key');
  });
});
