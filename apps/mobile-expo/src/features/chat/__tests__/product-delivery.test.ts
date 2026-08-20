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
    kind: 'task',
    id: 'task/1',
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
        content: [{ type: 'text', text: 'Updated task.' }],
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
      result: appendProductDeliveryText('Updated task.', delivery),
    })).toEqual(delivery);
  });

  it('maps native and fallback destinations predictably', () => {
    expect(mobileProductRoute(delivery.primary!)).toBe('/tasks/task%2F1');
    expect(mobileProductRoute({
      kind: 'task',
      id: 'task-1',
    })).toBe('/tasks/task-1');
    expect(mobileRouteFromProductDeepLink(productReferenceDeepLink(delivery.primary!)))
      .toBe('/tasks/task%2F1');
    const workflow = {
      kind: 'workflow_run' as const,
      id: 'run-1',
      title: 'Run',
      projectId: 'project/1',
      capabilities: ['open' as const],
    };
    expect(mobileProductRoute(workflow)).toBe('/workflows/runs/run-1?projectId=project%2F1');
    expect(mobileRouteFromProductDeepLink(productReferenceDeepLink(workflow))).toBe('/workflows/runs/run-1');
  });
});
