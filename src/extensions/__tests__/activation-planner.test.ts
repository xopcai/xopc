import { describe, expect, it } from 'vitest';
import { ActivationPlanner } from '../activation-planner.js';
import { ManifestRegistry } from '../manifest-registry.js';
import type { DiscoveredExtension } from '../types/loader.js';

function regFrom(manifests: DiscoveredExtension[]): ManifestRegistry {
  return ManifestRegistry.fromDiscovered(manifests);
}

describe('ActivationPlanner', () => {
  it('respects explicit enabled and disabled', () => {
    const planner = new ActivationPlanner(
      regFrom([
        {
          id: 'a',
          path: '/a',
          source: 'bundled',
          manifest: { id: 'a', name: 'A' },
        },
        {
          id: 'b',
          path: '/b',
          source: 'bundled',
          manifest: { id: 'b', name: 'B' },
        },
      ]),
    );
    const ids = planner.getActivatedIds({
      enabledIds: ['a'],
      disabledIds: ['b'],
      env: {},
    });
    expect(ids).toContain('a');
    expect(ids).not.toContain('b');
  });

  it('activates on channel trigger', () => {
    const planner = new ActivationPlanner(
      regFrom([
        {
          id: 'telegram',
          path: '/t',
          source: 'bundled',
          manifest: {
            id: 'telegram',
            name: 'T',
            channels: ['telegram'],
            activation: { onChannels: ['telegram'] },
          },
        },
      ]),
    );
    const ids = planner.getActivatedIds({
      configuredChannelIds: ['telegram'],
      env: {},
    });
    expect(ids).toContain('telegram');
  });

  it('activates enabledByDefault', () => {
    const planner = new ActivationPlanner(
      regFrom([
        {
          id: 'x',
          path: '/x',
          source: 'bundled',
          manifest: { id: 'x', name: 'X', enabledByDefault: true },
        },
      ]),
    );
    expect(planner.getActivatedIds({ env: {} })).toContain('x');
  });

  it('activates channel contribution extensions so setup actions are available before config', () => {
    const planner = new ActivationPlanner(
      regFrom([
        {
          id: 'weixin',
          path: '/weixin',
          source: 'bundled',
          manifest: {
            id: 'weixin',
            name: 'Weixin',
            channelContributions: {
              weixin: { label: 'Weixin' },
            },
          },
        },
      ]),
    );
    expect(planner.getActivatedIds({ env: {} })).toContain('weixin');
  });

  it('normalizes activation.onStartup', () => {
    const planner = new ActivationPlanner(
      regFrom([
        {
          id: 'boot',
          path: '/boot',
          source: 'bundled',
          manifest: {
            id: 'boot',
            name: 'Boot',
            enabledByDefault: true,
            activation: { onStartup: true },
          },
        },
      ]),
    );
    const ids = planner.getActivatedIds({ env: {} });
    expect(planner.filterActivatedIdsByLoadPhase(ids, 'startup')).toContain('boot');
    expect(planner.filterActivatedIdsByLoadPhase(ids, 'deferred')).not.toContain('boot');
  });
});
