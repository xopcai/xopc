/** Empty-chat shortcut chip shown above the composer (new session only). */

export const EMPTY_CHAT_GOAL_PREFILL = '/goal ';

export const EMPTY_CHAT_GOAL_SHORTCUT = {
  id: 'goal' as const,
  icon: 'flag-outline',
  labelKey: 'goal' as const,
};

export type EmptyChatShortcutId = typeof EMPTY_CHAT_GOAL_SHORTCUT.id;
