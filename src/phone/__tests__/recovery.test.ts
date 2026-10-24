import { describe, expect, it } from 'vitest';

import type { PhoneAction, PhoneElement, PhoneObservation } from '../contracts.js';
import type { PhoneTrajectoryEntry } from '../model-adapter.js';
import { confirmPhoneFocusRecovery, phoneBackRecovery, phoneUnfocusedTypingHint, preparePhoneFocusRecovery } from '../recovery.js';

function node(overrides: Partial<PhoneElement> = {}): PhoneElement {
  return { text: '', description: '', resourceId: 'app:id/query', bounds: [100, 100, 900, 200],
    clickable: true, editable: true, focused: false, password: false, ...overrides };
}
function screen(elements: PhoneElement[] = [], overrides: Partial<PhoneObservation> = {}): PhoneObservation {
  return { frameId: 'before', capturedAt: 0, package: 'com.example.app', width: 1000, height: 2000,
    rotation: 0, frame: Buffer.alloc(0), elements, ...overrides };
}
const completion = { appPackage: 'com.example.app', field: { resourceId: 'app:id/query', value: 'query' } };
const type: PhoneAction = { type: 'typeText', text: 'query', mode: 'replace' };

describe('native navigation recovery', () => {
  it('rejects entry-page Back after scrolling without claiming an OS root proof', () => {
    const entry = screen([node({ editable: false, text: 'Top row' })]);
    const current = screen([node({ editable: false, text: 'Bottom row' })]);
    const trajectory: PhoneTrajectoryEntry[] = [{ action: { type: 'swipe', start: [500, 800], end: [500, 300], durationMs: 500 },
      dispatch: 'completed', effect: 'changed', beforeApp: current.package, afterApp: current.package }];
    expect(phoneBackRecovery({ action: { type: 'back' }, observation: current, entryObservation: entry, trajectory }))
      .toMatchObject({ reason: 'entry_boundary' });
  });

  it('allows Back for an observed in-app Back affordance, focused editor, or completed forward transition', () => {
    const entry = screen();
    for (const current of [screen([node({ description: 'Navigate up', editable: false })]), screen([node({ focused: true })])]) {
      expect(phoneBackRecovery({ action: { type: 'back' }, observation: current, entryObservation: entry, trajectory: [] })).toBeUndefined();
    }
    expect(phoneBackRecovery({ action: { type: 'back' }, observation: entry, entryObservation: entry, trajectory: [{
      action: { type: 'tap', point: [200, 300] }, dispatch: 'completed', effect: 'changed', beforeApp: entry.package, afterApp: entry.package,
    }] })).toBeUndefined();
  });

  it('does not label an untracked changed page as the observed entry state merely because its package is equal', () => {
    const entry = screen([node({ editable: false, text: 'Entry' })]);
    const current = screen([node({ editable: false, text: 'Different page' })]);
    expect(phoneBackRecovery({ action: { type: 'back' }, observation: current, entryObservation: entry, trajectory: [] })).toBeUndefined();
  });

  it('does not treat a drawer button as a Back affordance based on android:id/home alone', () => {
    const current = screen([node({ resourceId: 'android:id/home', description: 'Show roots', editable: false })]);
    expect(phoneBackRecovery({ action: { type: 'back' }, observation: current, entryObservation: current, trajectory: [] })?.reason)
      .toBe('entry_boundary');
  });

  it('requires native nodes for the entry boundary instead of retaining screenshot pixels', () => {
    expect(phoneBackRecovery({ action: { type: 'back' }, observation: screen(), entryObservation: screen(), trajectory: [] })).toBeUndefined();
    expect(phoneBackRecovery({ action: { type: 'back' }, observation: screen([node({ editable: false })]), entryObservation: screen(), trajectory: [] })).toBeUndefined();
  });

  it('does not treat system navigation or unchanged/unknown/human taps as forward app navigation', () => {
    const current = screen([node({ description: 'Back', resourceId: 'com.android.systemui:id/back', editable: false })]);
    for (const entry of [{ effect: 'unchanged', dispatch: 'completed' }, { effect: 'changed', dispatch: 'unknown' }, { effect: 'changed', dispatch: 'completed', actor: 'human' }] as const) {
      expect(phoneBackRecovery({ action: { type: 'back' }, observation: current, entryObservation: current, trajectory: [{
        action: { type: 'tap', point: [200, 300] }, beforeApp: current.package, afterApp: current.package, ...entry,
      }] })?.reason).toBe('entry_boundary');
    }
  });

  it('keeps an unfinished recognized destination visible rather than backing out before its value is revealed', () => {
    const current = screen([node({ text: 'About device', editable: false }),
      node({ description: 'Navigate up', resourceId: 'app:id/up', editable: false })]);
    const input = { action: { type: 'back' as const }, observation: current, entryObservation: screen(), trajectory: [],
      completion: { appPackage: current.package, textAny: ['About device'], textAll: ['Android version', '15'] } };
    expect(phoneBackRecovery(input)?.reason).toBe('destination_incomplete');
    current.elements.push(node({ text: 'Android version', resourceId: 'app:id/version_label', editable: false }),
      node({ text: '15', resourceId: 'app:id/version', editable: false }));
    expect(phoneBackRecovery(input)).toBeUndefined();
  });
});

describe('explicit typing focus recovery', () => {
  it('replans a model Type on a page without its input rather than guessing a focus target', () => {
    const current = screen([node({ text: 'Search button', editable: false })]);
    expect(preparePhoneFocusRecovery(type, current, completion)).toBeUndefined();
    expect(phoneUnfocusedTypingHint(type, current, completion)).toContain('No text was sent');
    expect(phoneUnfocusedTypingHint({ type: 'back' }, current, completion)).toBeUndefined();
    expect(phoneUnfocusedTypingHint(type, screen([node({ focused: true })]), completion)).toBeUndefined();
  });

  it('turns an actual model typing intent into focus then releases it only after fresh confirmed focus', () => {
    const before = screen([node({ text: 'old query' })]);
    const recovery = preparePhoneFocusRecovery(type, before, completion)!;
    expect(recovery.focusAction).toEqual({ type: 'tapElement', frameId: 'before', selector: { resourceId: 'app:id/query', text: 'old query' } });
    expect(confirmPhoneFocusRecovery(recovery, before)).toBeUndefined();
    expect(confirmPhoneFocusRecovery(recovery, screen([node({ text: 'old query', focused: true })], { frameId: 'after' }))).toEqual(type);
  });

  it('never derives text input from completion alone, changes intent, or steals another focused editor', () => {
    expect(preparePhoneFocusRecovery({ type: 'back' }, screen([node()]), completion)).toBeUndefined();
    expect(preparePhoneFocusRecovery({ ...type, text: 'another query' }, screen([node()]), completion)).toBeUndefined();
    expect(preparePhoneFocusRecovery(type, screen([node()]))).toBeUndefined();
    expect(preparePhoneFocusRecovery(type, screen([node(), node({ resourceId: 'app:id/other', focused: true })]), completion)).toBeUndefined();
    expect(preparePhoneFocusRecovery({ ...type, mode: 'insert' }, screen([node({ text: 'old query' })]), completion)).toBeUndefined();
  });

  it('rejects ambiguous, password, clipped or wrong-app focus targets', () => {
    for (const current of [screen([node(), node()]), screen([node({ password: true })]),
      screen([node({ bounds: [0, 0, 1200, 100] })]), screen([node()], { package: 'com.other.app' })]) {
      expect(preparePhoneFocusRecovery(type, current, completion)).toBeUndefined();
    }
  });

  it('discards pending typing if the app, orientation, text, target identity or focus changes after the focus tap', () => {
    const recovery = preparePhoneFocusRecovery(type, screen([node()]), completion)!;
    const good = screen([node({ focused: true })], { frameId: 'after' });
    for (const current of [{ ...good, package: 'com.other.app' }, { ...good, rotation: 1 },
      screen([node({ focused: true, text: 'changed by user' })], { frameId: 'after' }),
      screen([node({ focused: true, password: true })], { frameId: 'after' }),
      screen([node({ focused: true }), node()], { frameId: 'after' }),
      screen([node({ focused: true }), node({ focused: true, resourceId: 'app:id/other' })], { frameId: 'after' })]) {
      expect(confirmPhoneFocusRecovery(recovery, current)).toBeUndefined();
    }
  });
});
