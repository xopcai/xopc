import { describe, expect, it } from 'vitest';

import { buildReloadPlan } from '../rules.ts';

describe('extension config reload rules', () => {
  it('extensions.feishu subtree is hot', () => {
    const plan = buildReloadPlan(['extensions.feishu.appSecret']);
    expect(plan.requiresRestart).toBe(false);
    expect(plan.requiresHotReload).toBe(true);
    expect(plan.hotPaths).toContain('extensions.feishu.appSecret');
  });

  it('extensions.enabled requires restart', () => {
    const plan = buildReloadPlan(['extensions.enabled']);
    expect(plan.requiresRestart).toBe(true);
  });

  it('extensions.disabled requires restart', () => {
    const plan = buildReloadPlan(['extensions.disabled']);
    expect(plan.requiresRestart).toBe(true);
  });
});
