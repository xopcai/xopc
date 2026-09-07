import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../../../../config/schema.js';
import { applyMiscPatch } from '../misc.js';

describe('applyMiscPatch context compaction', () => {
  it('updates the strict context-planning compaction policy', async () => {
    const config = ConfigSchema.parse({});
    const result = await applyMiscPatch(config, {
      userContext: {
        contextPlanning: {
          compaction: {
            enabled: false,
            triggerThreshold: 0.72,
            summaryRetries: 4,
            postCompactionSections: ['Red Lines'],
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(config.userContext.contextPlanning.compaction).toMatchObject({
      enabled: false,
      triggerThreshold: 0.72,
      summaryRetries: 4,
      postCompactionSections: ['Red Lines'],
    });
  });

  it('rejects removed memory configuration', async () => {
    const config = ConfigSchema.parse({});
    const result = await applyMiscPatch(config, {
      userContext: { memory: { retention: { compaction: true } } },
    });
    expect(result.ok).toBe(false);
  });
});
