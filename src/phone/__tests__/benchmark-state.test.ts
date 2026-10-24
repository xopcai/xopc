import { describe, expect, it, vi } from 'vitest';

import { armOrder, fingerprint, nativeFacts, type ArmName } from '../../../scripts/phone-apps-live/support.js';
import { tasks, CONTACTS, type TaskDevice } from '../../../scripts/phone-apps-live/tasks.js';
import { initialStateReady } from '../../../scripts/phone-apps-live/initial-state.js';
import type { PhoneObservation } from '../contracts.js';

const screen = (): PhoneObservation => ({ frameId: 'one', capturedAt: 0, package: 'com.example.app', width: 1000, height: 2000, rotation: 0, frame: Buffer.alloc(0),
  elements: [{ text: '', description: '', resourceId: 'container', clickable: true, focused: false, password: false, bounds: [0, 100, 1000, 300] },
    { text: 'Device', description: '', resourceId: '', clickable: false, focused: false, password: false, bounds: [100, 100, 250, 150] }] });

describe('real phone benchmark initialization and ordering', () => {
  it('switches every arm pair from AB to BA on the second task repeat', () => {
    const arms: ArmName[] = ['before-planning', 'after-planning', 'before-combined', 'after-combined'];
    for (let task = 0; task < 11; task++) {
      const first = armOrder(arms, task, 1); const second = armOrder(arms, task, 2);
      expect(new Set(first)).toEqual(new Set(arms));
      expect(new Set(second)).toEqual(new Set(arms));
      for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) {
        expect(first.indexOf(arms[i]) < first.indexOf(arms[j])).not.toBe(second.indexOf(arms[i]) < second.indexOf(arms[j]));
      }
      expect(first[0]).not.toBe(second[0]);
    }
  });

  it('retains geometry and focus changes in the exact initial native fingerprint', () => {
    const initial = screen(); const changed = screen();
    changed.elements[1].bounds[2]++;
    expect(fingerprint(changed)).not.toBe(fingerprint(initial));
    changed.elements[1].bounds[2]--;
    changed.elements[0].focused = true;
    expect(fingerprint(changed)).not.toBe(fingerprint(initial));
  });

  it('records empty native containers and actionability to diagnose exact initialization mismatches', () => {
    const initial = screen(); initial.elements.push({ ...initial.elements[1], password: true, text: 'private-value' });
    const facts = nativeFacts(initial);
    expect(facts.nodes).toHaveLength(2);
    expect(facts.nodes[0]).toMatchObject({ resourceId: 'container', text: '', clickable: true });
    expect(JSON.stringify(facts)).not.toContain('private-value');
  });
  it('requires the loaded Contacts list without normalizing onboarding or focused-list states', () => {
    const initial = screen(); initial.package = 'com.google.android.contacts';
    initial.elements = [{ ...initial.elements[0], resourceId: 'com.google.android.contacts:id/empty_view' },
      { ...initial.elements[1], text: 'No contacts yet' }];
    expect(initialStateReady(initial)).toBe(false);
    initial.elements = [{ ...initial.elements[0], resourceId: 'android:id/list' }];
    expect(initialStateReady(initial)).toBe(true);
    initial.elements[0].focused = true;
    expect(initialStateReady(initial)).toBe(false);
    initial.elements = [{ ...initial.elements[0], resourceId: 'com.google.android.contacts:id/open_search_view_edit_text', editable: true, focused: false }];
    expect(initialStateReady(initial)).toBe(false);
    expect(initialStateReady(initial, true)).toBe(true);
  });

});


describe('Contacts fixture navigation', () => {
  const home = () => {
    const value = screen(); value.package = CONTACTS;
    value.elements = [{ text: '', description: 'Contacts', resourceId: `${CONTACTS}:id/contacts`, clickable: true, focused: false, password: false, bounds: [0, 1800, 300, 1950] }];
    return value;
  };
  const fixture = (screens: PhoneObservation[]) => {
    const tap = vi.fn<TaskDevice['tap']>(async () => {}); const start = vi.fn<TaskDevice['start']>(async () => {}); const pressBack = vi.fn<TaskDevice['pressBack']>(async () => {});
    const device: TaskDevice = { tap, start, pressBack, pressTab: async () => {}, forceStop: async () => {},
      observe: async () => screens.shift() ?? home() };
    return { device, tap, start, pressBack };
  };
  it('prefers an actual home navigation control over a stale search editor', async () => {
    const value = home(); value.elements.push({ ...value.elements[0], resourceId: `${CONTACTS}:id/open_search_view_edit_text`, editable: true, bounds: [0, 0, 0, 0] });
    const f = fixture([value]);
    await tasks.find(task => task.id === 'contacts-search')!.prepare(f.device);
    expect(f.pressBack).not.toHaveBeenCalled();
    expect(f.tap.mock.calls[0]).toEqual(['Contacts', { resourceId: `${CONTACTS}:id/contacts`, preferDescription: true }]);
  });
  it('restarts the requested component when the foreground is Launcher instead of pressing Back', async () => {
    const value = home(); value.package = 'com.google.android.apps.nexuslauncher';
    const f = fixture([value, home()]);
    await tasks.find(task => task.id === 'contacts-search')!.prepare(f.device);
    expect(f.start).toHaveBeenCalledTimes(2);
    expect(f.pressBack).not.toHaveBeenCalled();
  });
  it('uses the visible in-app search back control rather than a hardware back event', async () => {
    const value = home(); value.elements = [
      { ...value.elements[0], resourceId: `${CONTACTS}:id/open_search_view_edit_text`, description: '', editable: true, bounds: [100, 100, 800, 200] },
      { ...value.elements[0], resourceId: '', description: 'Back', bounds: [0, 100, 100, 200] },
    ];
    const f = fixture([value, home()]);
    await tasks.find(task => task.id === 'contacts-search')!.prepare(f.device);
    expect(f.tap.mock.calls.map(call => call[0])).toEqual(['Back', 'Contacts']);
    expect(f.pressBack).not.toHaveBeenCalled();
  });
});
