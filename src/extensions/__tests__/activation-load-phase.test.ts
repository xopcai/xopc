import { describe, expect, it } from 'vitest';

import { ActivationPlanner } from '../activation-planner.js';
import { ManifestRegistry } from '../manifest-registry.js';
import { areExtensionsGloballyDisabled } from '../discover-extensions.js';

describe('Activation load phase', () => {
  const registry = ManifestRegistry.fromDiscovered([
    {
      id: 'eager',
      path: '/eager',
      source: 'bundled',
      manifest: { id: 'eager', name: 'Eager', enabledByDefault: true },
    },
    {
      id: 'lazy',
      path: '/lazy',
      source: 'bundled',
      manifest: {
        id: 'lazy',
        name: 'Lazy',
        enabledByDefault: true,
        activation: { onStartup: false },
      },
    },
  ]);

  it('splits startup vs deferred activated extensions', () => {
    const planner = new ActivationPlanner(registry);
    const activated = planner.getActivatedIds({ env: {} });
    expect(activated).toContain('eager');
    expect(activated).toContain('lazy');

    expect(planner.filterActivatedIdsByLoadPhase(activated, 'startup')).toEqual(['eager']);
    expect(planner.filterActivatedIdsByLoadPhase(activated, 'deferred')).toEqual(['lazy']);
  });

  it('detects globally disabled extensions config', () => {
    expect(areExtensionsGloballyDisabled({ extensions: { enabled: false } })).toBe(true);
    expect(areExtensionsGloballyDisabled({ extensions: { enabled: ['telegram'] } })).toBe(false);
  });
});
