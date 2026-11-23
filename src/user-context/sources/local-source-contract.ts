export const TIER1_LOCAL_UNDERSTANDING_SOURCE_IDS = [
  'local-ai-instructions',
  'local-obsidian',
  'local-markdown-notes',
  'local-recent-files',
  'chromium-bookmarks',
] as const;

export const TIER2_LOCAL_UNDERSTANDING_SOURCE_IDS = [
  'apple-notes',
  'apple-mail',
  'apple-calendar',
  'apple-reminders',
] as const;

export const LOCAL_UNDERSTANDING_SOURCE_IDS = [
  ...TIER1_LOCAL_UNDERSTANDING_SOURCE_IDS,
  ...TIER2_LOCAL_UNDERSTANDING_SOURCE_IDS,
] as const;

export type Tier1LocalUnderstandingSourceId = typeof TIER1_LOCAL_UNDERSTANDING_SOURCE_IDS[number];
export type Tier2LocalUnderstandingSourceId = typeof TIER2_LOCAL_UNDERSTANDING_SOURCE_IDS[number];
export type LocalUnderstandingSourceId = typeof LOCAL_UNDERSTANDING_SOURCE_IDS[number];

export function isTier1LocalSourceId(value: string): value is Tier1LocalUnderstandingSourceId {
  return (TIER1_LOCAL_UNDERSTANDING_SOURCE_IDS as readonly string[]).includes(value);
}

export function isTier2LocalSourceId(value: string): value is Tier2LocalUnderstandingSourceId {
  return (TIER2_LOCAL_UNDERSTANDING_SOURCE_IDS as readonly string[]).includes(value);
}

export function isLocalUnderstandingSourceId(value: string): value is LocalUnderstandingSourceId {
  return (LOCAL_UNDERSTANDING_SOURCE_IDS as readonly string[]).includes(value);
}

export function localSourceInstanceId(sourceId: string): string {
  return `local:${sourceId}`;
}
