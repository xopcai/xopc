import { describe, expect, it } from 'vitest';

import type { Config } from '../../../../../config/schema.js';
import { applyAgentsPatch } from '../agents.js';

describe('applyAgentsPatch', () => {
  it('rejects removed agents config patches', () => {
    expect(() =>
      applyAgentsPatch({ agents: { default: 'main', capabilityPresets: {}, list: [] } } as Config, {
        agents: { defaultPreset: 'default' },
      }),
    ).toThrow(/agents config patching was removed/);
  });
});
