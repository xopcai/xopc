export const LOCAL_UNDERSTANDING_SOURCE_IDS = [
  'local-recent-files',
  'chromium-bookmarks',
  'apple-notes',
  'apple-mail',
  'apple-calendar',
  'apple-reminders',
  'windows-recent-documents',
  'linux-recent-documents',
] as const;

export type LocalUnderstandingSourceId = typeof LOCAL_UNDERSTANDING_SOURCE_IDS[number];

export function isLocalUnderstandingSourceId(value: string): value is LocalUnderstandingSourceId {
  return (LOCAL_UNDERSTANDING_SOURCE_IDS as readonly string[]).includes(value);
}
