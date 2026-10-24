import { describe, expect, it } from 'vitest';

import { tasks, CLOCK, FILES, SETTINGS, SETTINGS_SEARCH, NOTE_FILE, FILE_QUERY } from '../../../scripts/phone-apps-live/tasks.js';
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
});
