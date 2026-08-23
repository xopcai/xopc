import type { ElectronUnderstandingSourceDefinition } from '@/types/electron';

const DEFAULT_ONBOARDING_SOURCE_IDS = new Set([
  'local-recent-files',
  'chromium-bookmarks',
  'apple-notes',
  'apple-calendar',
  'apple-reminders',
]);

export function defaultSelectedLocalSourceIds(
  sources: ElectronUnderstandingSourceDefinition[],
): Set<string> {
  return new Set(sources
    .filter((source) => (
      source.availability === 'available' && DEFAULT_ONBOARDING_SOURCE_IDS.has(source.id)
    ))
    .map((source) => source.id));
}
