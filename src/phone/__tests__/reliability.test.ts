import { describe, expect, it } from 'vitest';

import { canDispatchPhoneAction, observationSignature, phoneCompletionSatisfied } from '../reliability.js';
import { PhoneCompletionSchema } from '../contracts.js';
import type { PhoneElement, PhoneObservation } from '../contracts.js';

const target: PhoneElement = { text: 'Search', description: '', resourceId: 'search', clickable: true, focused: false, password: false, bounds: [100, 200, 300, 400] };
const screen = (elements: PhoneElement[]): PhoneObservation => ({ frameId: 'capture', capturedAt: Date.now(), package: 'com.app.test', width: 1000, height: 1000, rotation: 0, frame: Buffer.from('pixels'), elements });
const tap = { type: 'tap' as const, point: [200, 300] };

describe('phone target freshness', () => {
  it('ignores an unrelated countdown but still rejects target text, position, focus and app changes', () => {
    const clock = { ...target, text: '10:00', resourceId: 'com.android.systemui:id/clock', clickable: false, bounds: [0, 800, 500, 900] as PhoneElement['bounds'] };
    const before = screen([target, clock]);
    expect(canDispatchPhoneAction(tap, before, screen([target, { ...clock, text: '10:01' }]))).toBe(true);
    for (const change of [{ text: 'Delete' }, { bounds: [150, 200, 350, 400] as PhoneElement['bounds'] }, { focused: true }])
      expect(canDispatchPhoneAction(tap, before, screen([{ ...target, ...change }, clock]))).toBe(false);
    expect(canDispatchPhoneAction(tap, before, { ...before, package: 'com.app.other' })).toBe(false);
  });
  it('rejects new overlays, duplicate target IDs, and blind pixel changes', () => {
    const before = screen([target]);
    expect(canDispatchPhoneAction(tap, before, screen([target, { ...target, resourceId: 'overlay' }]))).toBe(false);
    expect(canDispatchPhoneAction(tap, before, screen([target, { ...target, bounds: [0, 800, 100, 900] }]))).toBe(false);
    expect(canDispatchPhoneAction(tap, screen([]), { ...screen([]), frame: Buffer.from('changed') })).toBe(false);
  });
  it('rejects changed product or recipient context even when the action button stays identical', () => {
    const header = { ...target, text: 'Product A', resourceId: 'header', clickable: false, bounds: [0, 0, 1000, 100] as PhoneElement['bounds'] };
    expect(canDispatchPhoneAction(tap, screen([header, target]), screen([{ ...header, text: 'Product B' }, target]))).toBe(false);
    const editor = { ...target, focused: true, editable: true };
    expect(canDispatchPhoneAction({ type: 'typeText', text: 'hello' }, screen([header, editor]), screen([{ ...header, text: 'Other recipient' }, editor]))).toBe(false);
  });
  it('does not relax swipes against changing layouts', () => {
    expect(canDispatchPhoneAction({ type: 'swipe', start: [500, 800], end: [500, 300], durationMs: 500 }, screen([target]), screen([{ ...target, text: 'changed' }]))).toBe(false);
  });
  it('uses semantic contents instead of capture IDs and PNG bytes when native nodes exist', () => {
    expect(observationSignature(screen([target]))).toBe(observationSignature({ ...screen([target]), frameId: 'new', capturedAt: 0, frame: Buffer.from('new encoding') }));
    expect(observationSignature(screen([target]))).not.toBe(observationSignature(screen([{ ...target, text: 'changed' }])));
  });
});

describe('combined phone UI verification', () => {
  it('requires localized alternatives, every required label, correct app and exact field value', () => {
    const condition = { appPackage: 'com.app.test', textAny: ['Search', '搜索'], textAll: ['Ready'], field: { resourceId: 'query', value: 'coffee' } };
    const nodes = [target, { ...target, resourceId: 'status', text: 'Ready' }, { ...target, resourceId: 'query', text: 'coffee', editable: true }];
    expect(phoneCompletionSatisfied(condition, screen(nodes), false)).toBe(true);
    expect(phoneCompletionSatisfied(condition, screen(nodes.slice(1)), false)).toBe(false);
    expect(phoneCompletionSatisfied(condition, screen(nodes.map(node => node.resourceId === 'query' ? { ...node, text: 'coffee shop' } : node)), false)).toBe(false);
    expect(phoneCompletionSatisfied(condition, { ...screen(nodes), package: 'com.app.other' }, false)).toBe(false);
  });
  it('does not accept password text or an unchanged initial state as required progress', () => {
    expect(phoneCompletionSatisfied({ textAny: ['Search'] }, screen([{ ...target, password: true }]), true)).toBe(false);
    expect(phoneCompletionSatisfied({ textAny: ['Search'], requireChange: true }, screen([target]), false)).toBe(false);
    expect(phoneCompletionSatisfied({ textAny: ['Search'], requireChange: true }, screen([target]), true)).toBe(true);
    expect(PhoneCompletionSchema.safeParse({ requireChange: true }).success).toBe(false);
  });
});
