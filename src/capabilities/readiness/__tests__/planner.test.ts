import { describe, expect, it } from 'vitest';

import { planCapabilities } from '../planner.js';
import type { CapabilityCandidate, CapabilityId, CapabilityPlannerInput } from '../types.js';

function candidate(
  capability: CapabilityId,
  model: string,
  priority: number,
  ready = true,
): CapabilityCandidate {
  return {
    capability, provider: 'xopc-cloud', model, priority, ready,
    source: 'xopc-cloud-managed', reasons: ready ? [] : ['oauth_not_connected'],
  };
}

function input(overrides: Partial<CapabilityPlannerInput> = {}): CapabilityPlannerInput {
  return {
    policies: {
      vision: {}, 'image-generation': {}, stt: {}, tts: {},
    },
    automatic: {},
    ...overrides,
  };
}

describe('capability planner', () => {
  it('uses deterministic priority and lexical ordering', () => {
    const plans = planCapabilities(input({
      automatic: {
        vision: [candidate('vision', 'z', 10), candidate('vision', 'b', 0), candidate('vision', 'a', 0)],
      },
    }));

    expect(plans.vision.primary?.model).toBe('a');
    expect(plans.vision.fallbacks.map((item) => item.model)).toEqual(['b', 'z']);
  });

  it('marks fallback from an unavailable explicit model as degraded', () => {
    const plans = planCapabilities(input({
      policies: {
        vision: { explicit: [{ provider: 'custom', model: 'gone', ready: false }] },
        'image-generation': {}, stt: {}, tts: {},
      },
      automatic: { vision: [candidate('vision', 'managed', 0)] },
    }));

    expect(plans.vision).toMatchObject({
      status: 'degraded',
      primary: { model: 'managed', source: 'xopc-cloud-managed' },
      rejected: [{ model: 'gone', reasons: ['explicit_model_unavailable'] }],
    });
  });

  it('lets an explicit disabled policy win over every candidate', () => {
    const plans = planCapabilities(input({
      policies: {
        vision: {}, 'image-generation': {}, stt: { disabled: true }, tts: {},
      },
      automatic: { stt: [candidate('stt', 'cloud-stt', 0)] },
    }));

    expect(plans.stt).toEqual(expect.objectContaining({
      status: 'disabled', selectionSource: 'none', fallbacks: [],
    }));
  });
});
