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

  it('preserves filenameHint for data URLs', async () => {
    const cfg = { agents: { defaults: { workspace: '/tmp' } } } as any as Config;
    const loaded = await loadMediaForFeishu(
      cfg,
      `data:application/pdf;base64,${Buffer.from('%PDF-1.4').toString('base64')}`,
      { maxBytes: 1024, localRoots: [], filenameHint: 'quarterly-report.pdf' },
    );
    expect(loaded.filename).toBe('quarterly-report.pdf');
    expect(loaded.mimeType).toBe('application/pdf');
  });
});

