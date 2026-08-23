import type { UnderstandingSourceDefinition, UnderstandingSourcePlatform } from './types.js';

const COMMON: UnderstandingSourceDefinition[] = [
  {
    id: 'local-work-folders', category: 'files', platform: 'all', displayName: 'Work folders',
    description: 'Discover likely work folders and analyze only folders you approve.',
    availability: 'available', permission: 'not_requested', defaultAccessMode: 'continuous',
    supportedAccessModes: ['once', 'continuous'], recommended: true, sensitive: false,
  },
  {
    id: 'local-recent-files', category: 'recent_documents', platform: 'all', displayName: 'Recent files',
    description: 'Read-only metadata for recent documents on Desktop, Documents, and Downloads.',
    availability: 'available', permission: 'not_requested', defaultAccessMode: 'once',
    supportedAccessModes: ['once'], recommended: true, sensitive: true,
  },
  {
    id: 'chromium-bookmarks', category: 'recent_documents', platform: 'all', displayName: 'Recent bookmarks',
    description: 'Titles, folders, and sanitized domains for recently added Chromium bookmarks.',
    availability: 'available', permission: 'not_requested', defaultAccessMode: 'once',
    supportedAccessModes: ['once'], recommended: true, sensitive: true,
  },
  {
    id: 'connector-github', category: 'code_activity', platform: 'all', displayName: 'GitHub',
    description: 'Repositories, pull requests, issues, and recent code activity from an account you connect.',
    availability: 'available', permission: 'not_requested', defaultAccessMode: 'continuous',
    supportedAccessModes: ['once', 'continuous'], recommended: true, sensitive: false,
  },
  {
    id: 'connector-calendar', category: 'calendar', platform: 'all', displayName: 'Connected calendar',
    description: 'Calendar commitments and recurring work rhythms from a connected account.',
    availability: 'available', permission: 'not_requested', defaultAccessMode: 'continuous',
    supportedAccessModes: ['once', 'continuous'], recommended: true, sensitive: true,
  },
  {
    id: 'connector-drive', category: 'files', platform: 'all', displayName: 'Cloud documents',
    description: 'Selected cloud documents and metadata from a connected workspace.',
    availability: 'available', permission: 'not_requested', defaultAccessMode: 'continuous',
    supportedAccessModes: ['once', 'continuous'], recommended: false, sensitive: true,
  },
  {
    id: 'connector-mail', category: 'mail', platform: 'all', displayName: 'Mail',
    description: 'Work themes and commitments from explicitly connected mail.',
    availability: 'available', permission: 'not_requested', defaultAccessMode: 'continuous',
    supportedAccessModes: ['once', 'continuous'], recommended: false, sensitive: true,
  },
  {
    id: 'connector-messages', category: 'messages', platform: 'all', displayName: 'Messages',
    description: 'Work themes from explicitly connected collaboration messages.',
    availability: 'available', permission: 'not_requested', defaultAccessMode: 'continuous',
    supportedAccessModes: ['once', 'continuous'], recommended: false, sensitive: true,
  },
];

const PLATFORM: Record<Exclude<UnderstandingSourcePlatform, 'all'>, UnderstandingSourceDefinition[]> = {
  darwin: [
    ['apple-notes', 'notes', 'Apple Notes', 'Recent unlocked notes selected through macOS Automation', true],
    ['apple-calendar', 'calendar', 'Apple Calendar', 'Recent and upcoming calendar events', true],
    ['apple-reminders', 'tasks', 'Apple Reminders', 'Open and recently completed reminders', true],
  ].map(([id, category, displayName, description, sensitive]) => ({
    id: String(id), category: category as UnderstandingSourceDefinition['category'], platform: 'darwin',
    displayName: String(displayName), description: String(description), availability: 'available',
    permission: 'not_requested', defaultAccessMode: 'once', supportedAccessModes: ['once'],
    recommended: category !== 'notes', sensitive: Boolean(sensitive),
  })),
  win32: [{
    id: 'windows-recent-documents', category: 'recent_documents', platform: 'win32',
    displayName: 'Recent documents', description: 'Metadata for files in Windows Recent Items',
    availability: 'available', permission: 'granted', defaultAccessMode: 'once',
    supportedAccessModes: ['once'], recommended: true, sensitive: false,
  }],
  linux: [{
    id: 'linux-recent-documents', category: 'recent_documents', platform: 'linux',
    displayName: 'Recent documents', description: 'Metadata from the freedesktop recent-files list',
    availability: 'available', permission: 'granted', defaultAccessMode: 'once',
    supportedAccessModes: ['once'], recommended: true, sensitive: false,
  }],
};

export function listUnderstandingSourceDefinitions(
  platform: Exclude<UnderstandingSourcePlatform, 'all'> = process.platform as Exclude<UnderstandingSourcePlatform, 'all'>,
): UnderstandingSourceDefinition[] {
  return [...COMMON, ...(PLATFORM[platform] ?? [])];
}
