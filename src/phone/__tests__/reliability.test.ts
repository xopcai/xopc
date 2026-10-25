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
  it('allows navigation past the labeled Settings uptime without hiding other page changes', () => {
    const about = { ...target, text: '', description: '关于手机', resourceId: 'com.android.settings:id/collapsing_toolbar', clickable: false, bounds: [0, 0, 600, 80] as PhoneElement['bounds'] };
    const label = { ...about, text: '开机累计时长', description: '', resourceId: 'android:id/title', bounds: [36, 700, 216, 741] as PhoneElement['bounds'] };
    const value = { ...about, text: '35:47:09', description: '', resourceId: 'android:id/summary', bounds: [36, 741, 118, 770] as PhoneElement['bounds'] };
    const before = { ...screen([about, label, value, target]), package: 'com.android.settings' };
    const fresh = { ...before, elements: [about, label, { ...value, text: '35:47:12' }, target] };
    expect(observationSignature(before)).toBe(observationSignature(fresh));
    expect(canDispatchPhoneAction({ type: 'back' }, before, fresh)).toBe(true);
    expect(canDispatchPhoneAction({ type: 'swipe', start: [500, 800], end: [500, 300], durationMs: 500 }, before, fresh)).toBe(true);
    expect(canDispatchPhoneAction(tap, before, fresh)).toBe(true);
    const up = { ...target, text: '', description: '向上导航', resourceId: '' };
    const withUp = { ...before, elements: [about, label, value, up] };
    const freshUp = { ...fresh, elements: [about, label, { ...value, text: '35:47:12' }, up] };
    expect(canDispatchPhoneAction(tap, withUp, freshUp)).toBe(true);
    expect(canDispatchPhoneAction(tap, { ...withUp, elements: [...withUp.elements, { ...up, bounds: [400, 500, 600, 700] }] },
      { ...freshUp, elements: [...freshUp.elements, { ...up, bounds: [400, 500, 600, 700] }] })).toBe(false);
    expect(canDispatchPhoneAction(tap, withUp, { ...freshUp, elements: freshUp.elements.map(node => node === up ? { ...up, description: 'Delete' } : node) })).toBe(false);
    expect(canDispatchPhoneAction({ type: 'back' }, before, { ...fresh, elements: [about, label, { ...value, text: '35:47:12' }, { ...target, text: 'Delete' }] })).toBe(false);
    for (const change of [{ package: 'com.other.app' }, { width: 900 }])
      expect(canDispatchPhoneAction({ type: 'back' }, before, { ...fresh, ...change })).toBe(false);
    for (const mutation of [
      (nodes: PhoneElement[]) => nodes.map(node => node === label ? { ...node, text: 'Payment timer' } : node),
      (nodes: PhoneElement[]) => nodes.map(node => node.resourceId === value.resourceId ? { ...node, editable: true } : node),
      (nodes: PhoneElement[]) => nodes.map(node => node === label ? { ...node, bounds: [36, 600, 216, 641] as PhoneElement['bounds'] } : node),
      (nodes: PhoneElement[]) => [...nodes, { ...about, resourceId: 'overlay', text: 'Confirm' }],
    ]) expect(canDispatchPhoneAction({ type: 'back' }, before, { ...fresh, elements: mutation(fresh.elements) })).toBe(false);
    const otherBefore = { ...before, package: 'com.other.app' };
    expect(canDispatchPhoneAction({ type: 'back' }, otherBefore, { ...fresh, package: 'com.other.app' })).toBe(false);
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
