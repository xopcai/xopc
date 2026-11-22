import type { ElectronUnderstandingSourceDefinition } from '@/types/electron';

// Only zero-prompt local sources are enabled by default during onboarding.
// OS permission-gated apps (Apple Notes/Mail/Calendar/Reminders) stay opt-in / just-in-time.
const DEFAULT_ONBOARDING_SOURCE_IDS = new Set([
  'local-recent-files',
  'chromium-bookmarks',
  'windows-recent-documents',
  'linux-recent-documents',
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
