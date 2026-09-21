import type { BrowserControlResult, BrowserNode } from '@xopcai/browser-control-contract';
import { describe, expect, it } from 'vitest';

import {
  fitBrowserControlResultToFrame,
  MAX_BROWSER_CONTROL_RESULT_BYTES,
} from './result-budget';

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function node(index: number): BrowserNode {
  return {
    ref: `xopc-e${index}`,
    role: 'textbox',
    name: `Field ${index} ${'n'.repeat(220)}`,
    value: 'v'.repeat(500),
    states: [],
    bounds: { x: index, y: index, width: 200, height: 30 },
  };
}

function result(nodes: BrowserNode[], visual?: string): BrowserControlResult {
  return {
    ok: true,
    receipt: {
      action: 'observe',
      risk: 'read',
      durationMs: 1,
      verified: true,
      observation: {
        sessionId: 'session-1',
        tabId: '7',
        revision: 1,
        documentId: 'document-1',
        url: 'https://example.com',
        title: 'Example',
        nodes,
        changes: { added: nodes, changed: nodes, removed: [] },
        ...(visual ? { visual: { mimeType: 'image/jpeg', data: visual } } : {}),
      },
    },
  };
}

describe('fitBrowserControlResultToFrame', () => {
  it('returns small results unchanged', () => {
    const input = result([node(1)]);
    expect(fitBrowserControlResultToFrame(input)).toBe(input);
  });

  it('removes an oversized inline screenshot before semantic nodes', () => {
    const input = result([node(1)], 'a'.repeat(MAX_BROWSER_CONTROL_RESULT_BYTES));
    const fitted = fitBrowserControlResultToFrame(input);
    const observation = fitted.ok ? fitted.receipt.observation : undefined;

    expect(bytes(fitted)).toBeLessThanOrEqual(MAX_BROWSER_CONTROL_RESULT_BYTES);
    expect(observation?.visual).toBeUndefined();
    expect(observation?.nodes).toHaveLength(1);
    expect(observation?.truncation).toMatchObject({ visualOmitted: true, omittedNodeCount: 0 });
  });

  it('drops duplicate changes and then trims nodes to the byte budget', () => {
    const nodes = Array.from({ length: 500 }, (_, index) => node(index));
    const fitted = fitBrowserControlResultToFrame(result(nodes));
    const observation = fitted.ok ? fitted.receipt.observation : undefined;

    expect(bytes(fitted)).toBeLessThanOrEqual(MAX_BROWSER_CONTROL_RESULT_BYTES);
    expect(observation?.nodes.length).toBeGreaterThan(0);
    expect(observation?.nodes.length).toBeLessThan(nodes.length);
    expect(observation?.changes).toEqual({ added: [], changed: [], removed: [] });
    expect(observation?.truncation?.omittedNodeCount).toBe(nodes.length - (observation?.nodes.length ?? 0));
  });
});
