import { storage } from '../storage/mmkv';

export type SyncJournalState = 'pending' | 'syncing' | 'conflict' | 'failed';

export type SyncJournalEntry<T = unknown> = {
  id: string;
  entity: 'note' | 'attachment' | 'task';
  entityId: string;
  kind: string;
  payload: T;
  baseVersion?: number;
  localVersion: number;
  dependsOn: string[];
  state: SyncJournalState;
  retryCount: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
};

const JOURNAL_KEY = 'workspace:sync-journal:v1';

function readEntries(): SyncJournalEntry[] {
  const raw = storage.getString(JOURNAL_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as SyncJournalEntry[] : [];
  } catch {
    return [];
  }
}

function writeEntries(entries: SyncJournalEntry[]): void {
  storage.set(JOURNAL_KEY, JSON.stringify(entries));
}

export function listSyncJournalEntries(): SyncJournalEntry[] {
  return readEntries();
}

export function appendSyncJournalEntry<T>(entry: Omit<SyncJournalEntry<T>, 'createdAt' | 'updatedAt' | 'state' | 'retryCount'>): SyncJournalEntry<T> {
  const now = Date.now();
  const next: SyncJournalEntry<T> = {
    ...entry,
    dependsOn: [...new Set(entry.dependsOn)],
    state: 'pending',
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  writeEntries([...readEntries(), next]);
  return next;
}

export function readySyncJournalEntries(
  entries = readEntries(),
  completedEntryIds: Iterable<string> = [],
): SyncJournalEntry[] {
  const completed = new Set(completedEntryIds);
  return entries.filter((entry) =>
    entry.state === 'pending' && entry.dependsOn.every((dependency) => completed.has(dependency)),
  );
}

export function updateSyncJournalEntry(id: string, patch: Partial<Pick<SyncJournalEntry, 'state' | 'retryCount' | 'error' | 'entityId'>>): SyncJournalEntry | null {
  let updated: SyncJournalEntry | null = null;
  const entries = readEntries().map((entry) => {
    if (entry.id !== id) return entry;
    updated = { ...entry, ...patch, updatedAt: Date.now() };
    return updated;
  });
  writeEntries(entries);
  return updated;
}

export function removeSyncJournalEntry(id: string): void {
  writeEntries(readEntries().filter((entry) => entry.id !== id));
}

export function clearSyncJournalForTests(): void {
  storage.delete(JOURNAL_KEY);
}
