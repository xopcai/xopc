import { describe, expect, it } from 'vitest';

import { PhoneActionSchema, PhoneConfigSchema, type PhoneElement, type PhoneObservation } from '../contracts.js';
import { groundPhoneCoordinateAction, phoneSemanticControls, resolvePhoneSemanticAction } from '../semantic-controls.js';

const node: PhoneElement = { text: 'Search', description: '', resourceId: 'app:id/search', clickable: true, focused: false, password: false, bounds: [100, 200, 300, 400] };
const screen = (elements: PhoneElement[] = [node]): PhoneObservation => ({ frameId: 'prediction', capturedAt: 1, width: 1000, height: 1000, rotation: 0, package: 'com.app.test', frame: Buffer.from('pixels'), elements });
const action = { type: 'tapElement' as const, frameId: 'prediction', selector: { resourceId: node.resourceId, text: node.text } };

describe('exact native control execution', () => {
  it('resolves an exact identity on a fresh capture to the native node center', () => {
    expect(resolvePhoneSemanticAction(action, screen(), { ...screen(), frameId: 'fresh', capturedAt: 2 })).toEqual({ type: 'tap', point: [200, 300] });
  });
  it('rejects duplicates, partial matches and invisible or password targets', () => {
    for (const elements of [[node, { ...node, bounds: [500, 200, 700, 400] as PhoneElement['bounds'] }], [{ ...node, text: 'Search results' }], [{ ...node, password: true }], [{ ...node, bounds: [-10, 200, 300, 400] as PhoneElement['bounds'] }]])
      expect(() => resolvePhoneSemanticAction(action, screen(elements))).toThrow(/exactly one/);
  });
  it('rejects capture mismatches and a moved, relabelled or changed page', () => {
    expect(() => resolvePhoneSemanticAction({ ...action, frameId: 'old' }, screen())).toThrow(/different observation/);
    for (const fresh of [screen([{ ...node, bounds: [200, 200, 400, 400] }]), { ...screen(), package: 'com.app.other' }, screen([node, { ...node, resourceId: 'overlay', text: 'Confirm' }])])
      expect(() => resolvePhoneSemanticAction(action, screen(), fresh)).toThrow(/changed before dispatch/);
  });
  it('preserves the system clock freshness exception', () => {
    const clock: PhoneElement = { ...node, resourceId: 'com.android.systemui:id/clock', text: '10:00', clickable: false, bounds: [0, 0, 100, 100] };
    expect(resolvePhoneSemanticAction(action, screen([node, clock]), screen([node, { ...clock, text: '10:01' }]))).toEqual({ type: 'tap', point: [200, 300] });
  });
  it('offers only unique non-password exact identities, without truncating selector text', () => {
    const longLabel = 'x'.repeat(500);
    const observation = screen([node, { ...node, resourceId: 'long', text: longLabel }, { ...node, resourceId: 'secret', password: true }]);
    expect(phoneSemanticControls(observation)).toEqual([
      { frameId: 'prediction', selector: { resourceId: node.resourceId, text: 'Search' } },
      { frameId: 'prediction', selector: { resourceId: 'long', text: longLabel } },
    ]);
    expect(phoneSemanticControls(screen([node, node]))).toEqual([]);
  });
  it('requires bounded nonempty exact selectors and defaults both experimental features off', () => {
    expect(PhoneActionSchema.safeParse({ ...action, selector: {} }).success).toBe(false);
    expect(PhoneActionSchema.safeParse({ ...action, selector: { text: '', match: 'contains' } }).success).toBe(false);
    expect(PhoneConfigSchema.parse({})).toMatchObject({ semanticControls: false, hierarchicalPlanning: false });
  });
});

describe('coordinate tap grounding', () => {
  const tap = { type: 'tap' as const, point: [105, 205] };
  it('anchors coordinate jitter inside one native control to the same exact identity', () => {
    for (const point of [[105, 205], [295, 395], [200, 300]]) {
      const grounded = groundPhoneCoordinateAction({ type: 'tap', point }, screen());
      expect(grounded).toEqual(action);
      expect(resolvePhoneSemanticAction(grounded, screen())).toEqual({ type: 'tap', point: [200, 300] });
    }
  });
  it('uses a strict smallest nested actionable target but never a large root container', () => {
    const root = { ...node, resourceId: 'root', text: '', bounds: [0, 0, 1000, 1000] as PhoneElement['bounds'] };
    expect(groundPhoneCoordinateAction(tap, screen([root, node]))).toEqual(action);
    expect(groundPhoneCoordinateAction(tap, screen([root]))).toEqual(tap);
  });
  it('falls back for overlapping siblings, equal bounds and duplicate exact identity', () => {
    const overlap = { ...node, resourceId: 'other', text: 'Other', bounds: [50, 250, 350, 450] as PhoneElement['bounds'] };
    expect(groundPhoneCoordinateAction({ ...tap, point: [200, 300] }, screen([node, overlap]))).toEqual({ ...tap, point: [200, 300] });
    expect(groundPhoneCoordinateAction(tap, screen([node, { ...node, resourceId: 'other' }]))).toEqual(tap);
    expect(groundPhoneCoordinateAction(tap, screen([node, { ...node, bounds: [500, 200, 700, 400] }]))).toEqual(tap);
  });
  it('does not move a coordinate into a separate nested control at the native center', () => {
    const child = { ...node, resourceId: 'child', text: 'Delete', bounds: [190, 290, 210, 310] as PhoneElement['bounds'] };
    expect(groundPhoneCoordinateAction(tap, screen([node, child]))).toEqual(tap);
  });
  it('leaves password, clipped, unnamed, non-actionable and empty targets as coordinates', () => {
    for (const elements of [[{ ...node, password: true }], [{ ...node, bounds: [-10, 200, 300, 400] as PhoneElement['bounds'] }],
      [{ ...node, text: '', resourceId: '' }], [{ ...node, clickable: false }], []])
      expect(groundPhoneCoordinateAction(tap, screen(elements))).toEqual(tap);
    const password = { ...node, password: true, resourceId: 'password', bounds: [190, 290, 210, 310] as PhoneElement['bounds'] };
    expect(groundPhoneCoordinateAction(tap, screen([node, password]))).toEqual(tap);
  });
  it('preserves non-tap actions and taps outside all native controls', () => {
    const back = { type: 'back' as const };
    expect(groundPhoneCoordinateAction(back, screen())).toBe(back);
    expect(groundPhoneCoordinateAction({ ...tap, point: [900, 900] }, screen())).toEqual({ ...tap, point: [900, 900] });
  });
});
