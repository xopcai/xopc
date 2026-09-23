import { describe, expect, it } from 'vitest';

import { isAgentCatalogCacheKey } from '@/features/gateway/gateway-realtime-bridge';

describe('Agent catalog cache invalidation', () => {
  it('matches every Agent-backed SWR cache without invalidating unrelated resources', () => {
    expect(isAgentCatalogCacheKey('settings-gateway-agents')).toBe(true);
    expect(isAgentCatalogCacheKey(['gateway-chat-agents', 'gateway-token'])).toBe(true);
    expect(isAgentCatalogCacheKey(['workflow-agents', 'gateway-token'])).toBe(true);
    expect(isAgentCatalogCacheKey('channel-routing-agents')).toBe(true);
    expect(isAgentCatalogCacheKey(['workflow-definitions', 'gateway-token'])).toBe(false);
    expect(isAgentCatalogCacheKey('gateway-config')).toBe(false);
  });
});
