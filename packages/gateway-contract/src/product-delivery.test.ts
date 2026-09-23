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
  version: 2,
  operation: 'created',
  primary: {
    kind: 'note',
    id: 'note/with spaces',
    title: 'Research note',
    capabilities: ['open', 'edit', 'continue_in_chat'],
  },
};

describe('product delivery contract', () => {
  it('validates bounded read-only table and proposed edit presentations', () => {
    const table: ProductDeliveryEnvelope = { version: 2, operation: 'opened', presentation: { kind: 'table', items: [delivery.primary!], truncated: false } };
    expect(parseProductDeliveryText(appendProductDeliveryText('Rows', table))).toEqual(table);
    expect(parseProductDeliveryEnvelope({ ...table, presentation: { ...table.presentation, items: Array(51).fill(delivery.primary) } })).toBeNull();
    expect(parseProductDeliveryEnvelope({ version: 2, operation: 'opened', presentation: {
      kind: 'diff', title: 'Proposal', truncated: false, edits: [{ from: 5, to: 1, text: 'bad range' }],
    } })).toBeNull();
    expect(parseProductDeliveryEnvelope({ version: 2, operation: 'opened', presentation: {
      kind: 'diff', title: 'Proposal', truncated: false, edits: [{ from: 0, to: 1, text: 'x'.repeat(16001) }],
    } })).toBeNull();
    const inline = parseProductDeliveryEnvelope({ version: 2, operation: 'opened', presentation: {
      kind: 'inline_app', preferredHeight: 520,
      reference: { kind: 'local_app', id: 'app-1', title: 'Dashboard', revision: 'a'.repeat(64), capabilities: ['open', 'fix'] },
      snapshot: { sourceHash: 'a'.repeat(64) },
    } });
    expect(inline?.presentation).toMatchObject({ kind: 'inline_app', preferredHeight: 520 });
    expect(parseProductDeliveryEnvelope({ version: 2, operation: 'opened', presentation: {
      kind: 'inline_app', preferredHeight: 520,
      reference: { kind: 'note', id: 'note-1', title: 'No', capabilities: [] },
      snapshot: { sourceHash: 'a'.repeat(64) },
    } })).toBeNull();
    expect(parseProductDeliveryEnvelope({ version: 2, operation: 'opened', presentation: {
      kind: 'inline_app', preferredHeight: 520,
      reference: { kind: 'local_app', id: 'app-1', title: 'Dashboard', revision: 'b'.repeat(64), capabilities: [] },
      snapshot: { sourceHash: 'a'.repeat(64) },
    } })).toBeNull();
    const preview = parseProductDeliveryEnvelope({ version: 2, operation: 'created', presentation: {
      kind: 'inline_preview', preferredHeight: 480,
      reference: { kind: 'chat_preview', id: crypto.randomUUID(), title: 'Login', revision: 'c'.repeat(64), capabilities: ['preview', 'fix'] },
      sourceHash: 'c'.repeat(64),
    } });
    expect(preview?.presentation).toMatchObject({ kind: 'inline_preview', sourceHash: 'c'.repeat(64) });
    expect(parseProductDeliveryEnvelope({ version: 2, operation: 'created', presentation: {
      kind: 'inline_preview', preferredHeight: 480,
      reference: { kind: 'chat_preview', id: crypto.randomUUID(), title: 'Login', revision: 'd'.repeat(64), capabilities: [] },
      sourceHash: 'c'.repeat(64),
    } })).toBeNull();
  });
  it('accepts session keys without changing canonical id links or other kinds', () => {
    const key = 'agent:coder:webchat:default:direct:chat_801605448ec548c9b90d1c4eb5024727';
    expect(parseProductReferenceDeepLink(`xopc://open?kind=session&key=${key}`))
      .toEqual({ kind: 'session', id: key });
    expect(parseProductReferenceDeepLink(`xopc://open?kind=session&id=canonical&key=${key}`))
      .toEqual({ kind: 'session', id: 'canonical' });
    expect(parseProductReferenceDeepLink('xopc://open?kind=session&key=%20')).toBeNull();
    expect(parseProductReferenceDeepLink('xopc://open?kind=note&key=note-1')).toBeNull();
  });

  it('validates and round-trips a delivery embedded in tool text', () => {
    const text = appendProductDeliveryText('Created note.', delivery);

    expect(parseProductDeliveryText(text)).toEqual(delivery);
    expect(text).toContain('[Open](xopc://open?kind=note&id=note%2Fwith+spaces)');
    expect(parseProductDeliveryEnvelope({ version: 1 })).toBeNull();
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
    expect(productReferenceRoute({
      kind: 'task',
      id: 'task/with spaces',
      title: 'Task',
      capabilities: ['open'],
    })).toBe('/tasks/task%2Fwith%20spaces');
    expect(productReferenceRoute({
      kind: 'scene',
      id: 'scene/with spaces',
      title: 'Scene',
      capabilities: ['open'],
    })).toBe('/scenes/scene%2Fwith%20spaces');
  });
});
