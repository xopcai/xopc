import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../schema.js';

describe('code intelligence config', () => {
  it('enables managed code intelligence for coder by default', () => {
    const config = ConfigSchema.parse(undefined);
    expect(config.codeIntelligence).toMatchObject({
      enabled: true,
      agentIds: ['coder'],
      indexMode: 'moderate',
      autoIndex: true,
      autoRefresh: true,
    });
  });

  it('accepts an explicit binary and disabled runtime', () => {
    const defaults = ConfigSchema.parse(undefined);
    const config = ConfigSchema.parse({
      ...defaults,
      codeIntelligence: {
        ...defaults.codeIntelligence,
        enabled: false,
        binaryPath: '/opt/xopc/codebase-memory-mcp',
      },
    });
    expect(config.codeIntelligence.enabled).toBe(false);
    expect(config.codeIntelligence.binaryPath).toBe('/opt/xopc/codebase-memory-mcp');
  });
});
