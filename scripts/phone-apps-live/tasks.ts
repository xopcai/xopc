import assert from 'node:assert/strict';

import type { PhoneCompletion, PhoneObservation } from '../../src/phone/contracts.js';
import { texts, visibleNode } from './support.js';

export const NOTE_FILE = 'xopc_real_bench_note_20261024.txt';
export const PLAN_FILE = 'xopc_real_bench_plan_20261024.txt';
export const FILE_QUERY = 'xopc_real_bench_note_20261024';
export const CONTACTS = 'com.google.android.contacts';
export const HOLDOUT_QUERY = 'xopc_holdout_20261024';
export const FOCUS_QUERY = 'xopc_focus_transfer_20261024';
export const CLOCK = 'com.google.android.deskclock';
export const FILES = 'com.google.android.documentsui';
export const SETTINGS = 'com.android.settings';
export const SETTINGS_SEARCH = 'com.google.android.settings.intelligence';
export const SCRATCH_FILES = { [NOTE_FILE]: 'xopc live benchmark note\n', [PLAN_FILE]: 'xopc live benchmark plan\n' };

export type TaskDevice = {
  observe(): Promise<PhoneObservation>;
  start(app: string): Promise<void>;
  forceStop(app: string): Promise<void>;
  tap(label: string, options?: { resourceId?: string; preferDescription?: boolean }): Promise<void>;
  pressBack(): Promise<void>;
  pressTab(): Promise<void>;
};
export type Task = {
  split?: 'development' | 'heldout' | 'transfer';
  id: string; app: string; allowedApps: string[]; goal: string;
  completion(version: string): PhoneCompletion;
  prepare(device: TaskDevice): Promise<void>;
  evidence(screen: PhoneObservation, version: string): Record<string, boolean>;
};

const exact = (screen: PhoneObservation, value: string) => texts(screen).includes(value);
const node = (screen: PhoneObservation, resourceId: string, value?: string) => screen.elements.some(candidate => visibleNode(candidate, screen)
  && candidate.resourceId === resourceId && (value === undefined || candidate.text === value));

async function settings(device: TaskDevice) {
  await device.forceStop(SETTINGS_SEARCH);
  await device.forceStop(SETTINGS);
  await device.start(SETTINGS);
}
async function clockAlarm(device: TaskDevice) {
  await device.forceStop(CLOCK); await device.start(CLOCK);
  await device.tap('Timer', { resourceId: `${CLOCK}:id/tab_menu_timer` });
  for (let attempt = 0; attempt < 7; attempt++) {
    const screen = await device.observe();
    try {
      if (node(screen, `${CLOCK}:id/timer_setup_time`, '00h 00m 00s')) break;
      assert(screen.elements.some(candidate => candidate.resourceId === `${CLOCK}:id/timer_setup_delete`), 'Timer must remain in editable, unstarted setup');
      assert(attempt < 6, 'Timer setup reset exceeded six digits');
    } finally { screen.frame.fill(0); }
    await device.tap('Backspace', { resourceId: `${CLOCK}:id/timer_setup_delete` });
  }
  await device.tap('Alarm', { resourceId: `${CLOCK}:id/tab_menu_alarm` });
}
async function filesRoot(device: TaskDevice, label: string) {
  await device.forceStop(FILES); await device.start(FILES);
  for (let attempt = 0; attempt < 3; attempt++) {
    const screen = await device.observe();
    const searching = screen.elements.some(candidate => candidate.resourceId === `${FILES}:id/search_src_text`);
    screen.frame.fill(0); if (!searching) break;
    await device.pressBack();
  }
  await device.tap('Show roots', { preferDescription: true });
  await device.tap(label, { resourceId: 'android:id/title' });
}

async function contactsRoot(device: TaskDevice) {
  await device.forceStop(CONTACTS); await device.start(CONTACTS);
  for (let attempt = 0; attempt < 6; attempt++) {
    const screen = await device.observe();
    let home = false; let closeSearch = false; let wrongApp = false;
    try {
      wrongApp = screen.package !== CONTACTS;
      if (!wrongApp) {
        home = screen.elements.some(candidate => visibleNode(candidate, screen) && candidate.resourceId === `${CONTACTS}:id/contacts` && candidate.description === 'Contacts');
        closeSearch = !home && screen.elements.some(candidate => visibleNode(candidate, screen) && candidate.editable && candidate.resourceId === `${CONTACTS}:id/open_search_view_edit_text`)
          && screen.elements.some(candidate => visibleNode(candidate, screen) && candidate.clickable && candidate.description === 'Back');
      }
    } finally { screen.frame.fill(0); }
    if (home) { await device.tap('Contacts', { resourceId: `${CONTACTS}:id/contacts`, preferDescription: true }); return; }
    if (wrongApp || attempt === 3) await device.start(CONTACTS);
    else if (closeSearch) {
      try { await device.tap('Back', { preferDescription: true }); }
      catch (error) { if (!(error instanceof Error) || !error.message.startsWith('Setup cannot find Back')) throw error; }
    }
  }
  assert.fail('Contacts home navigation did not become ready after bounded explicit reset');
}

async function contactsUnfocusedSearch(device: TaskDevice) {
  await contactsRoot(device);
  await device.tap('Search contacts', { resourceId: `${CONTACTS}:id/open_search_bar` });
  await device.pressTab();
  const screen = await device.observe();
  try {
    const field = screen.elements.filter(candidate => visibleNode(candidate, screen) && candidate.editable && candidate.resourceId === `${CONTACTS}:id/open_search_view_edit_text`);
    assert(field.length === 1 && !field[0].focused, 'Focus stress setup needs one visible, unfocused query field');
    assert(screen.elements.some(candidate => candidate.focused && !candidate.editable), 'Tab must focus a non-editor without activating it');
  } finally { screen.frame.fill(0); }
}

export const tasks: Task[] = [
  { id: 'settings-about-version', app: SETTINGS, allowedApps: [SETTINGS],
    goal: 'Open About emulated device or About phone in Android Settings, scroll as necessary, and show the Android version row together with its actual version value fully on screen. Stay on About phone; do not change any setting.',
    completion: version => ({ appPackage: SETTINGS, textAny: ['About emulated device', 'About phone'], textAll: ['Android version', version] }),
    prepare: settings,
    evidence: (screen, version) => {
      const index = screen.elements.findIndex(candidate => visibleNode(candidate, screen) && candidate.text === 'Android version');
      const following = index < 0 ? [] : screen.elements.slice(index + 1, index + 7);
      return { packageAllowed: screen.package === SETTINGS, aboutPage: exact(screen, 'About emulated device') || exact(screen, 'About phone'),
        versionRowFullyVisible: index >= 0, versionValueVisible: following.some(candidate => visibleNode(candidate, screen) && candidate.text === version) };
    } },
  { id: 'settings-display', app: SETTINGS, allowedApps: [SETTINGS],
    goal: 'Open the Display settings page and show Brightness level. Do not change brightness or any other setting.',
    completion: () => ({ appPackage: SETTINGS, textAny: ['Display', 'Display & touch'], textAll: ['Brightness level'] }), prepare: settings,
    evidence: screen => ({ packageAllowed: screen.package === SETTINGS, displayPage: exact(screen, 'Display') || exact(screen, 'Display & touch'), brightnessRow: exact(screen, 'Brightness level') }) },
  { id: 'settings-search-display', app: SETTINGS, allowedApps: [SETTINGS, SETTINGS_SEARCH],
    goal: 'Use Android Settings search to search for display. Leave the search query display in the search field and show the Display or Display & touch result. Do not open a result or change a setting.',
    completion: () => ({ appPackage: SETTINGS_SEARCH, textAny: ['Display', 'Display & touch'], field: { resourceId: `${SETTINGS_SEARCH}:id/open_search_view_edit_text`, value: 'display' } }), prepare: settings,
    evidence: screen => ({ packageAllowed: screen.package === SETTINGS_SEARCH,
      queryCorrect: screen.elements.some(candidate => visibleNode(candidate, screen) && candidate.editable && candidate.text === 'display'),
      resultVisible: screen.elements.some(candidate => visibleNode(candidate, screen) && candidate.resourceId === 'android:id/title' && ['Display', 'Display & touch'].includes(candidate.text)) }) },
  { id: 'clock-stopwatch', app: CLOCK, allowedApps: [CLOCK],
    goal: 'Open the Stopwatch tab in Clock, showing a stopped stopwatch at zero. Do not start, lap or reset any running stopwatch; do not create an alarm.',
    completion: () => ({ appPackage: CLOCK, textAll: ['Stopwatch', '00', 'Start'] }), prepare: clockAlarm,
    evidence: screen => ({ packageAllowed: screen.package === CLOCK,
      correctTab: node(screen, `${CLOCK}:id/action_bar_title`, 'Stopwatch'),
      zeroSeconds: node(screen, `${CLOCK}:id/stopwatch_time_text`, '00'),
      zeroHundredths: node(screen, `${CLOCK}:id/stopwatch_hundredths_text`, '00'),
      notRunning: screen.elements.some(candidate => visibleNode(candidate, screen) && candidate.resourceId === `${CLOCK}:id/fab` && candidate.description === 'Start') }) },
  { id: 'clock-timer-configure', app: CLOCK, allowedApps: [CLOCK],
    goal: 'Open Timer in Clock and enter a duration of exactly 2 minutes 30 seconds (00h 02m 30s). Leave the duration configured without starting the timer. Do not change alarms.',
    completion: () => ({ appPackage: CLOCK, textAll: ['00h 02m 30s'] }), prepare: clockAlarm,
    evidence: screen => ({ packageAllowed: screen.package === CLOCK,
      correctTab: node(screen, `${CLOCK}:id/action_bar_title`, 'Timer'),
      durationCorrect: node(screen, `${CLOCK}:id/timer_setup_time`, '00h 02m 30s'),
      stillSetup: node(screen, `${CLOCK}:id/timer_setup_digit_2`) }) },
  { id: 'files-downloads', app: FILES, allowedApps: [FILES],
    goal: `In Files, navigate from Recent to Downloads and locate ${NOTE_FILE}. Leave its filename visible; do not open, rename or delete a file.`,
    completion: () => ({ appPackage: FILES, textAll: ['Files in Downloads', NOTE_FILE] }),
    prepare: device => filesRoot(device, 'Recent'),
    evidence: screen => ({ packageAllowed: screen.package === FILES,
      downloadsFolder: node(screen, `${FILES}:id/header_title`, 'Files in Downloads'),
      fixtureVisible: exact(screen, NOTE_FILE) }) },
  { id: 'files-search', app: FILES, allowedApps: [FILES],
    goal: `In Files Downloads, use Search to search for ${FILE_QUERY}. Keep that query in the search field and show ${NOTE_FILE} as a result. Do not open or modify a file.`,
    completion: () => ({ appPackage: FILES, textAll: [NOTE_FILE], field: { resourceId: `${FILES}:id/search_src_text`, value: FILE_QUERY } }),
    prepare: device => filesRoot(device, 'Downloads'),
    evidence: screen => ({ packageAllowed: screen.package === FILES,
      queryCorrect: screen.elements.some(candidate => visibleNode(candidate, screen) && candidate.editable && candidate.resourceId === `${FILES}:id/search_src_text` && candidate.text === FILE_QUERY),
      resultVisible: exact(screen, NOTE_FILE), unrelatedFixtureAbsent: !exact(screen, PLAN_FILE) }) },
  { id: 'settings-storage', split: 'heldout', app: SETTINGS, allowedApps: [SETTINGS],
    goal: 'Open Storage in Android Settings and show the storage categories Apps and System. Do not change settings or delete anything.',
    completion: () => ({ appPackage: SETTINGS, textAll: ['Storage', 'Apps', 'System'] }), prepare: settings,
    evidence: screen => ({ packageAllowed: screen.package === SETTINGS, storagePage: screen.elements.some(candidate => visibleNode(candidate, screen) && candidate.resourceId === `${SETTINGS}:id/collapsing_toolbar` && candidate.description === 'Storage'), appsCategory: exact(screen, 'Apps'), systemCategory: exact(screen, 'System') }) },
  { id: 'clock-clock-tab', split: 'heldout', app: CLOCK, allowedApps: [CLOCK],
    goal: 'Open the Clock tab in the Clock app. Leave the world clock page visible without adding any city or changing any alarm.',
    completion: () => ({ appPackage: CLOCK, textAll: ['Clock', 'Add city'] }), prepare: clockAlarm,
    evidence: screen => ({ packageAllowed: screen.package === CLOCK, correctTab: node(screen, `${CLOCK}:id/action_bar_title`, 'Clock'), addCityVisible: screen.elements.some(candidate => visibleNode(candidate, screen) && candidate.resourceId === `${CLOCK}:id/fab` && candidate.description === 'Add city') }) },
  { id: 'contacts-search', split: 'heldout', app: CONTACTS, allowedApps: [CONTACTS],
    goal: `In Contacts, search for exactly ${HOLDOUT_QUERY}. Leave that query visible in the search field. Do not add, edit, import, delete or call any contact.`,
    completion: () => ({ appPackage: CONTACTS, field: { resourceId: `${CONTACTS}:id/open_search_view_edit_text`, value: HOLDOUT_QUERY } }), prepare: contactsRoot,
    evidence: screen => ({ packageAllowed: screen.package === CONTACTS, exactQuery: screen.elements.some(candidate => visibleNode(candidate, screen) && candidate.editable && candidate.resourceId === `${CONTACTS}:id/open_search_view_edit_text` && candidate.text === HOLDOUT_QUERY), clearControlVisible: screen.elements.some(candidate => visibleNode(candidate, screen) && candidate.resourceId === `${CONTACTS}:id/open_search_view_clear_button` && candidate.description === 'Clear text') }) },
  { id: 'contacts-organize', split: 'heldout', app: CONTACTS, allowedApps: [CONTACTS],
    goal: 'In Contacts, open the Organize tab and show Manage SIM and Blocked numbers. Stay on that page without opening a management action or changing contacts.',
    completion: () => ({ appPackage: CONTACTS, textAll: ['Organize', 'Manage SIM', 'Blocked numbers'] }), prepare: contactsRoot,
    evidence: screen => ({ packageAllowed: screen.package === CONTACTS, organizeSelected: node(screen, `${CONTACTS}:id/navigation_bar_item_large_label_view`, 'Organize'), manageSimVisible: exact(screen, 'Manage SIM'), blockedVisible: exact(screen, 'Blocked numbers') }) },

  ...([['clock-timer-transfer-0845', '00h 08m 45s'], ['clock-timer-transfer-010509', '01h 05m 09s']] as const).map(([id, duration]): Task => ({
    id, split: 'transfer', app: CLOCK, allowedApps: [CLOCK],
    goal: `Configure the stopped Timer in Clock to exactly ${duration}. Leave that duration configured without starting the timer. Do not change alarms.`,
    completion: () => ({ appPackage: CLOCK, textAll: [duration] }), prepare: clockAlarm,
    evidence: screen => ({ packageAllowed: screen.package === CLOCK,
      correctTab: node(screen, `${CLOCK}:id/action_bar_title`, 'Timer'),
      durationCorrect: node(screen, `${CLOCK}:id/timer_setup_time`, duration),
      stillSetup: node(screen, `${CLOCK}:id/timer_setup_digit_0`) }),
  })),
  { id: 'contacts-search-unfocused', split: 'transfer', app: CONTACTS, allowedApps: [CONTACTS],
    goal: `In the open Contacts search page, enter exactly ${FOCUS_QUERY} in the search field and leave that query visible. Do not add, edit, import, delete or call any contact.`,
    completion: () => ({ appPackage: CONTACTS, field: { resourceId: `${CONTACTS}:id/open_search_view_edit_text`, value: FOCUS_QUERY } }), prepare: contactsUnfocusedSearch,
    evidence: screen => ({ packageAllowed: screen.package === CONTACTS,
      exactQuery: screen.elements.some(candidate => visibleNode(candidate, screen) && candidate.editable && candidate.resourceId === `${CONTACTS}:id/open_search_view_edit_text` && candidate.text === FOCUS_QUERY),
      clearControlVisible: screen.elements.some(candidate => visibleNode(candidate, screen) && candidate.resourceId === `${CONTACTS}:id/open_search_view_clear_button` && candidate.description === 'Clear text') }) },
];
