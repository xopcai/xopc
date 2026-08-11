import { describe, expect, it } from 'vitest';

import { normalizeActivityDetailDefault } from '../activity-detail-config-api';

describe('normalizeActivityDetailDefault', () => {
  it('uses the calm collapsed mode when config is absent or invalid', () => {
    expect(normalizeActivityDetailDefault(undefined)).toBe('on');
    expect(normalizeActivityDetailDefault({ gateway: { webchat: { activityDetailDefault: 'x' } } })).toBe('on');
  });

  it('reads the configured gateway webchat value', () => {
    expect(normalizeActivityDetailDefault({
      gateway: { webchat: { activityDetailDefault: 'stream' } },
    })).toBe('stream');
  });
});
