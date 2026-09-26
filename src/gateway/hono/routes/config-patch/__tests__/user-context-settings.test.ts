import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../../../../config/schema.js';
import { applyMiscPatch } from '../misc.js';

describe('applyMiscPatch user context settings', () => {
  it('updates user-model maintenance and privacy settings', async () => {
    const config = ConfigSchema.parse({});
    const result = await applyMiscPatch(config, {
      userContext: {
        userModel: {
          sensitiveWritePolicy: 'deny',
          maintenance: { timezone: 'Asia/Shanghai', dailyTime: '02:30', limit: 250 },
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(config.userContext.userModel).toMatchObject({
      sensitiveWritePolicy: 'deny',
      maintenance: { timezone: 'Asia/Shanghai', dailyTime: '02:30', limit: 250 },
    });
  });

  it('updates Home suggestion generation independently', async () => {
    const config = ConfigSchema.parse({});
    const result = await applyMiscPatch(config, {
      userContext: { homeIntelligence: { enabled: false, refreshOnContextChange: false } },
    });
    expect(result.ok).toBe(true);
    expect(config.userContext.homeIntelligence).toEqual({
      enabled: false,
      refreshOnContextChange: false,
    });
  });

  it('rejects invalid and removed settings', async () => {
    await expect(applyMiscPatch(ConfigSchema.parse({}), {
      userContext: { userModel: { maintenance: { dailyTime: '25:00' } } },
    })).resolves.toMatchObject({ ok: false });
    await expect(applyMiscPatch(ConfigSchema.parse({}), {
      userContext: { dreaming: { mode: 'review' } },
    })).resolves.toMatchObject({ ok: false });
  });
});
