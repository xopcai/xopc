import { describe, expect, it } from 'vitest';

import {
  appendProductDeliveryText,
  parseProductDeliveryEnvelope,
  parseProductDeliveryText,
  parseProductReferenceDeepLink,
  productReferenceDeepLink,
  productReferenceOpenRoute,
  productReferenceRoute,
  type ProductDeliveryEnvelope,
} from './product-delivery.js';

const delivery: ProductDeliveryEnvelope = {
  version: 1,
  operation: 'created',
  primary: {
    kind: 'note',
    id: 'note/with spaces',
    title: 'Research note',
    capabilities: ['open', 'edit', 'continue_in_chat'],
  },
};

describe('product delivery contract', () => {
  it('validates and round-trips a delivery embedded in tool text', () => {
    const text = appendProductDeliveryText('Created note.', delivery);

    expect(parseProductDeliveryText(text)).toEqual(delivery);
    expect(text).toContain('[Open](xopc://open?kind=note&id=note%2Fwith+spaces)');
    expect(parseProductDeliveryEnvelope({ version: 2 })).toBeNull();
  });

  it('builds encoded product routes and portable deep links', () => {
    expect(productReferenceRoute(delivery.primary!)).toBe('/notes/note%2Fwith%20spaces');
    expect(productReferenceDeepLink(delivery.primary!)).toBe(
      'xopc://open?kind=note&id=note%2Fwith+spaces',
    );
    expect(parseProductReferenceDeepLink(productReferenceDeepLink(delivery.primary!))).toEqual({
      kind: 'note',
      id: 'note/with spaces',
    });
    expect(parseProductReferenceDeepLink('https://example.com')).toBeNull();
    expect(productReferenceRoute({
      kind: 'settings',
      id: 'extensions/debug',
      title: 'Extension debug',
      capabilities: ['open'],
    })).toBe('/settings/extensions/debug');
    expect(productReferenceOpenRoute({
      kind: 'local_app',
      id: 'app/with spaces',
      title: 'Local app',
      capabilities: ['open'],
    })).toBe('/open?kind=local_app&id=app%2Fwith+spaces');
    expect(productReferenceOpenRoute(delivery.primary!)).toBe('/notes/note%2Fwith%20spaces');
  });
});
