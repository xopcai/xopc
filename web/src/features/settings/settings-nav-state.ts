/** `location.state` key: when set, settings shell “back” returns to this path (must be in-app, single-segment root path). */
export const SETTINGS_BACK_PATH_STATE_KEY = 'settingsBackPath' as const;

export type SettingsNavLocationState = {
  [SETTINGS_BACK_PATH_STATE_KEY]?: string;
};
