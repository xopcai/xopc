import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../../../../config/schema.js';
import { applyMiscPatch } from '../misc.js';

describe('applyMiscPatch user context settings', () => {
  it('updates structured consolidation and privacy settings', async () => {
    const config = ConfigSchema.parse({});
    const result = await applyMiscPatch(config, {
      userContext: {
        dreaming: {
          mode: 'review', timezone: 'Asia/Shanghai', schedule: { time: '02:30' },
          minEvidenceSources: 3, limit: 250,
        },
        privacy: { sensitiveWritePolicy: 'deny' },
      },
    });
    expect(result.ok).toBe(true);
    expect(config.userContext.dreaming).toMatchObject({
      mode: 'review', timezone: 'Asia/Shanghai', schedule: { time: '02:30' },
      minEvidenceSources: 3, limit: 250,
    });
    expect(config.userContext.privacy).toEqual({ sensitiveWritePolicy: 'deny' });
  });

  it('rejects invalid schedules and privacy policies', async () => {
    await expect(applyMiscPatch(ConfigSchema.parse({}), {
      userContext: { dreaming: { mode: 'review', schedule: { time: '25:00' } } },
    })).resolves.toMatchObject({ ok: false });
    await expect(applyMiscPatch(ConfigSchema.parse({}), {
      userContext: { privacy: { sensitiveWritePolicy: 'sometimes' } },
    })).resolves.toMatchObject({ ok: false });
  });
});
