export type ScenarioPresetId = 'lightChat' | 'multiChannel' | 'automation';

export type ScenarioPresetStep = {
  path: string;
  labelKey: 'stepProviders' | 'stepDefaultModel' | 'stepChannel' | 'stepPresets' | 'stepCron' | 'stepSkills';
};

export type ScenarioPreset = {
  id: ScenarioPresetId;
  steps: ScenarioPresetStep[];
};

export const SCENARIO_PRESETS: readonly ScenarioPreset[] = [
  {
    id: 'lightChat',
    steps: [
      { path: '/settings/credentials?tab=providers', labelKey: 'stepProviders' },
      { path: '/agents', labelKey: 'stepDefaultModel' },
    ],
  },
  {
    id: 'multiChannel',
    steps: [
      { path: '/settings/credentials?tab=providers', labelKey: 'stepProviders' },
      { path: '/agents', labelKey: 'stepDefaultModel' },
      { path: '/channels', labelKey: 'stepChannel' },
      { path: '/agents', labelKey: 'stepPresets' },
    ],
  },
  {
    id: 'automation',
    steps: [
      { path: '/settings/credentials?tab=providers', labelKey: 'stepProviders' },
      { path: '/skills', labelKey: 'stepSkills' },
      { path: '/cron', labelKey: 'stepCron' },
    ],
  },
];

const SCENARIO_PRESETS_DISMISSED_KEY = 'xopc-scenario-presets-dismissed';

export function readScenarioPresetsDismissed(): boolean {
  try {
    return localStorage.getItem(SCENARIO_PRESETS_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function dismissScenarioPresets(): void {
  try {
    localStorage.setItem(SCENARIO_PRESETS_DISMISSED_KEY, 'true');
  } catch {
    /* ignore */
  }
}
