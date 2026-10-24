import { describe, expect, it } from 'vitest';

import { tasks, CLOCK, FILES, SETTINGS, SETTINGS_SEARCH, NOTE_FILE, FILE_QUERY, CONTACTS, HOLDOUT_QUERY } from '../../../scripts/phone-apps-live/tasks.js';
import type { PhoneElement, PhoneObservation } from '../contracts.js';

function node(text: string, resourceId = '', extra: Partial<PhoneElement> = {}): PhoneElement {
  return { text, resourceId, description: '', bounds: [10, 200, 500, 260], clickable: false, focused: false, password: false, ...extra };
}
function screen(app: string, nodes: PhoneElement[]): PhoneObservation {
  return { package: app, width: 1000, height: 2000, rotation: 0, frame: Buffer.alloc(0), frameId: 'test', capturedAt: 0, elements: nodes };
}
const passes = (id: string, observation: PhoneObservation) => Object.values(tasks.find(task => task.id === id)!.evidence(observation, '15')).every(Boolean);

describe('independent real-app evaluation oracles', () => {
  it('requires the actual version row and value within screen on the About page', () => {
    const nodes = [node('', 'toolbar', { description: 'About emulated device' }), node('Android version'), node('15')];
    expect(passes('settings-about-version', screen(SETTINGS, nodes))).toBe(true);
    expect(passes('settings-about-version', screen(SETTINGS, nodes.map(item => item.text === '15' ? { ...item, bounds: [10, 1990, 500, 2050] } : item)))).toBe(false);
    expect(passes('settings-about-version', screen(SETTINGS, nodes.slice(1)))).toBe(false);
    expect(passes('settings-about-version', screen(SETTINGS, [nodes[0], nodes[1], node('14')]))).toBe(false);
  });

  it('does not count a Clock tab label on the Alarm page as an opened stopped Stopwatch', () => {
    const rows = [node('Stopwatch', `${CLOCK}:id/action_bar_title`), node('00', `${CLOCK}:id/stopwatch_time_text`),
      node('00', `${CLOCK}:id/stopwatch_hundredths_text`), node('', `${CLOCK}:id/fab`, { description: 'Start' })];
    expect(passes('clock-stopwatch', screen(CLOCK, rows))).toBe(true);
    expect(passes('clock-stopwatch', screen(CLOCK, rows.map(item => item.resourceId.endsWith('action_bar_title') ? { ...item, text: 'Alarm' } : item)))).toBe(false);
    expect(passes('clock-stopwatch', screen(CLOCK, rows.map(item => item.description === 'Start' ? { ...item, description: 'Pause' } : item)))).toBe(false);
  });

  it('requires an exact unstarted timer value rather than a matching string elsewhere', () => {
    const rows = [node('Timer', `${CLOCK}:id/action_bar_title`), node('00h 02m 30s', `${CLOCK}:id/timer_setup_time`), node('2', `${CLOCK}:id/timer_setup_digit_2`)];
    expect(passes('clock-timer-configure', screen(CLOCK, rows))).toBe(true);
    expect(passes('clock-timer-configure', screen(CLOCK, rows.map(item => item.resourceId.endsWith('timer_setup_time') ? { ...item, resourceId: 'unrelated' } : item)))).toBe(false);
    expect(passes('clock-timer-configure', screen(CLOCK, rows.slice(0, 2)))).toBe(false);
  });

  it('requires Downloads folder identity rather than a file merely appearing in Recent', () => {
    const rows = [node('Files in Downloads', `${FILES}:id/header_title`), node(NOTE_FILE)];
    expect(passes('files-downloads', screen(FILES, rows))).toBe(true);
    expect(passes('files-downloads', screen(FILES, [node('Recent', `${FILES}:id/header_title`), rows[1]]))).toBe(false);
  });

  it('requires both Files search query and filtered result, rejecting stale or unfiltered lists', () => {
    const rows = [node(FILE_QUERY, `${FILES}:id/search_src_text`, { editable: true, focused: true }), node(NOTE_FILE)];
    expect(passes('files-search', screen(FILES, rows))).toBe(true);
    expect(passes('files-search', screen(FILES, rows.slice(1)))).toBe(false);
    expect(passes('files-search', screen(FILES, [...rows, node('xopc_real_bench_plan_20261024.txt')]))).toBe(false);
    expect(passes('files-search', screen(SETTINGS_SEARCH, rows))).toBe(false);
  });
  it('holds out four task IDs and validates the new Contacts query and page identities', () => {
    expect(tasks.filter(task => task.split === 'heldout').map(task => task.id)).toEqual(['settings-storage', 'clock-clock-tab', 'contacts-search', 'contacts-organize']);
    const search = [node(HOLDOUT_QUERY, `${CONTACTS}:id/open_search_view_edit_text`, { editable: true }), node('', `${CONTACTS}:id/open_search_view_clear_button`, { description: 'Clear text' })];
    expect(passes('contacts-search', screen(CONTACTS, search))).toBe(true);
    expect(passes('contacts-search', screen(CONTACTS, search.map(item => item.text === HOLDOUT_QUERY ? { ...item, text: 'other' } : item)))).toBe(false);
    const organize = [node('Organize', `${CONTACTS}:id/navigation_bar_item_large_label_view`), node('Manage SIM'), node('Blocked numbers')];
    expect(passes('contacts-organize', screen(CONTACTS, organize))).toBe(true);
    expect(passes('contacts-organize', screen(CONTACTS, organize.map(item => item.text === 'Organize' ? { ...item, resourceId: 'tab-unselected' } : item)))).toBe(false);
    expect(passes('contacts-organize', screen(SETTINGS, organize))).toBe(false);
  });

  it('requires the heldout Storage categories and world-clock page action', () => {
    expect(passes('settings-storage', screen(SETTINGS, [node('', `${SETTINGS}:id/collapsing_toolbar`, { description: 'Storage' }), node('Apps'), node('System')]))).toBe(true);
    expect(passes('settings-storage', screen(SETTINGS, [node('Storage'), node('Apps')]))).toBe(false);
    const world = [node('Clock', `${CLOCK}:id/action_bar_title`), node('', `${CLOCK}:id/fab`, { description: 'Add city' })];
    expect(passes('clock-clock-tab', screen(CLOCK, world))).toBe(true);
    expect(passes('clock-clock-tab', screen(CLOCK, [world[0], node('', `${CLOCK}:id/fab`, { description: 'Start' })]))).toBe(false);
  });

  it('keeps both transfer durations distinct from the development timer target', () => {
    const transfer = tasks.filter(task => task.split === 'transfer' && task.app === CLOCK);
    expect(transfer.map(task => task.id)).toEqual(['clock-timer-transfer-0845', 'clock-timer-transfer-010509']);
    for (const task of transfer) {
      const target = task.completion('15').textAll![0];
      const rows = [node('Timer', `${CLOCK}:id/action_bar_title`), node(target, `${CLOCK}:id/timer_setup_time`), node('0', `${CLOCK}:id/timer_setup_digit_0`)];
      expect(passes(task.id, screen(CLOCK, rows))).toBe(true);
      expect(passes(task.id, screen(CLOCK, rows.map(item => item.resourceId.endsWith('timer_setup_time') ? { ...item, text: '00h 02m 30s' } : item)))).toBe(false);
      expect(passes(task.id, screen(CLOCK, rows.slice(0, 2)))).toBe(false);
    }
  });

  it('rejects a Settings root list containing Storage, Apps and System without the Storage toolbar', () => {
    expect(passes('settings-storage', screen(SETTINGS, [node('Storage', 'android:id/title'), node('Apps'), node('System')]))).toBe(false);
  });

});
