import {
  appendProductDeliveryText,
  productReferenceDeepLink,
  type ProductDeliveryEnvelope,
} from '@xopcai/gateway-contract';
import { describe, expect, it } from 'vitest';

import {
  extractMobileProductDelivery,
  mobileProductRoute,
  mobileRouteFromProductDeepLink,
} from '../product-delivery';

const delivery: ProductDeliveryEnvelope = {
  version: 1,
  operation: 'updated',
  primary: {
    kind: 'work_item',
    id: 'work/1',
    title: 'Ship inline delivery',
    capabilities: ['open', 'edit', 'continue_in_chat'],
  },
};

describe('mobile product delivery', () => {
  it('extracts delivery from live structured tool results', () => {
    expect(extractMobileProductDelivery({
      type: 'tool_use',
      id: 'tool-1',
      name: 'xopc_use',
      status: 'done',
      result: {
        content: [{ type: 'text', text: 'Updated work item.' }],
        details: { delivery },
      },
    })).toEqual(delivery);
  });

  it('extracts delivery from persisted text-only tool results', () => {
    expect(extractMobileProductDelivery({
      type: 'tool_use',
      id: 'tool-2',
      name: 'xopc_use',
      status: 'done',
      result: appendProductDeliveryText('Updated work item.', delivery),
    })).toEqual(delivery);
  });

  it('maps native and fallback destinations predictably', () => {
    expect(mobileProductRoute(delivery.primary!)).toBe('/work/work%2F1');
    expect(mobileProductRoute({
      kind: 'goal',
      id: 'goal-1',
    })).toBe('/');
    expect(mobileRouteFromProductDeepLink(productReferenceDeepLink(delivery.primary!)))
      .toBe('/work/work%2F1');
  });
});
