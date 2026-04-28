/** `location.state` key: when set, settings shell “back” returns to this path (must be in-app, single-segment root path). */
export const SETTINGS_BACK_PATH_STATE_KEY = 'settingsBackPath' as const;

export type SettingsNavLocationState = {
  [SETTINGS_BACK_PATH_STATE_KEY]?: string;
};

/** Resolve “back” target from router location state (settings overlay close matches ← Back). */
export function resolveSettingsBackTarget(state: unknown): string {
  if (!state || typeof state !== 'object') {
    return '/chat';
  }
  const raw = (state as Record<string, unknown>)[SETTINGS_BACK_PATH_STATE_KEY];
  if (typeof raw !== 'string') {
    return '/chat';
  }
  const path = raw.trim();
  if (!path.startsWith('/') || path.startsWith('//')) {
    return '/chat';
  }
  return path;
}
