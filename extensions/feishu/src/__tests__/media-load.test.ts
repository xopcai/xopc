import { describe, expect, it } from 'vitest';

import type { Config } from '@xopcai/xopc/config/schema.js';

import { loadMediaForFeishu } from '../outbound/media-load.js';

describe('loadMediaForFeishu', () => {
  it('rejects empty input', async () => {
    const cfg = { agents: { defaults: { workspace: '/tmp' } } } as any as Config;
    await expect(loadMediaForFeishu(cfg, '   ', { maxBytes: 10, localRoots: [] })).rejects.toThrow(
      /empty media reference/i,
    );
  });
});

