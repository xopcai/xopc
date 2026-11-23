import { execFile } from 'node:child_process';

import type { IpcMain } from 'electron';

import { listLocalUnderstandingSourceDefinitions } from '../../src/user-context/sources/catalog.js';
import {
  collectTier1Source,
  fingerprintUnderstandingItems,
  previewTier1Sources,
} from '../../src/user-context/sources/collectors/index.js';
import {
  isLocalUnderstandingSourceId,
  isTier1LocalSourceId,
  isTier2LocalSourceId,
  type LocalUnderstandingSourceId,
  type Tier2LocalUnderstandingSourceId,
} from '../../src/user-context/sources/local-source-contract.js';
import type {
  UnderstandingSourceCollectionResult,
  UnderstandingSourceItem,
  UnderstandingSourcePlatform,
} from '../../src/user-context/sources/types.js';
import { assertTrustedRenderer } from './trusted-renderer.js';

const APPLE_NOTES_LIMIT = 60;
const APPLE_MAIL_SENT_LIMIT = 35;
const APPLE_MAIL_INBOX_LIMIT = 25;
const APPLE_DEFAULT_LIMIT = 50;
const ITEM_CHARS = 8_000;
const TOTAL_CHARS = 180_000;
const JXA_TIMEOUT_MS = 20_000;

export { fingerprintUnderstandingItems };

const JXA_HELPERS = `
const safe = (read, fallback) => { try { return read(); } catch (_) { return fallback; } };
const time = (value) => { const n = value ? new Date(value).getTime() : NaN; return Number.isFinite(n) ? n : undefined; };
`;

function appleScript(source: Tier2LocalUnderstandingSourceId): string {
  if (source === 'apple-notes') return `${JXA_HELPERS}
const app = Application('Notes');
const ids = safe(() => app.notes.id(), []);
const modDates = safe(() => app.notes.modificationDate(), []);
const lockedFlags = safe(() => app.notes.passwordProtected(), []);
const indexed = [];
for (let i = 0; i < ids.length; i++) {
  if (lockedFlags[i] === true || !ids[i]) continue;
  indexed.push({ index: i, id: String(ids[i]), modifiedAt: time(modDates[i]) || 0 });
}
indexed.sort((a, b) => b.modifiedAt - a.modifiedAt);
const top = indexed.slice(0, ${APPLE_NOTES_LIMIT});
const allNotes = app.notes;
const rows = [];
for (const entry of top) {
  const note = allNotes[entry.index];
  const text = String(safe(() => note.plaintext(), '')).trim();
  if (!text) continue;
  const container = safe(() => note.container(), null);
  rows.push({
    id: entry.id,
    title: String(safe(() => note.name(), 'Untitled')),
    group: container ? String(safe(() => container.name(), '')) : '',
    text,
    occurredAt: time(safe(() => note.creationDate(), null)),
    modifiedAt: entry.modifiedAt || undefined,
    ownerAttribution: 'user',
  });
}
JSON.stringify(rows);`;

  if (source === 'apple-mail') return `${JXA_HELPERS}
const app = Application('Mail');
const min = Date.now() - 45 * 86400000;
const sentRows = [];
const inboxRows = [];
for (const account of safe(() => app.accounts(), [])) {
  const accountName = String(safe(() => account.name(), 'Mail'));
  const boxes = [
    { box: safe(() => account.sentMailbox(), null), name: 'Sent', ownerAttribution: 'user', dateKey: 'dateSent', limit: ${APPLE_MAIL_SENT_LIMIT}, bucket: sentRows },
    { box: safe(() => account.inbox(), null), name: 'Inbox', ownerAttribution: 'other', dateKey: 'dateReceived', limit: ${APPLE_MAIL_INBOX_LIMIT}, bucket: inboxRows },
  ];
  for (const entry of boxes) {
    if (!entry.box || entry.bucket.length >= entry.limit) continue;
    const messages = safe(() => entry.box.messages.whose({ [entry.dateKey]: { _greaterThan: new Date(min) } })(), []);
    for (const message of messages.slice(0, entry.limit)) {
      const occurredAt = time(safe(() => entry.dateKey === 'dateSent' ? message.dateSent() : message.dateReceived(), null));
      const id = String(safe(() => message.messageId(), safe(() => message.id(), '')));
      if (!id || !occurredAt || occurredAt < min) continue;
      entry.bucket.push({
        id,
        title: String(safe(() => message.subject(), 'Untitled message')),
        group: accountName + ' · ' + entry.name,
        text: String(safe(() => message.content(), '')),
        occurredAt,
        ownerAttribution: entry.ownerAttribution,
      });
    }
  }
}
sentRows.sort((a, b) => b.occurredAt - a.occurredAt);
inboxRows.sort((a, b) => b.occurredAt - a.occurredAt);
JSON.stringify([...sentRows.slice(0, ${APPLE_MAIL_SENT_LIMIT}), ...inboxRows.slice(0, ${APPLE_MAIL_INBOX_LIMIT})]);`;

  if (source === 'apple-calendar') return `${JXA_HELPERS}
const app = Application('Calendar');
const now = Date.now(); const min = now - 30 * 86400000; const max = now + 30 * 86400000;
const rows = safe(() => app.calendars(), []).flatMap((calendar) => safe(() => calendar.events(), []).map((event) => ({
  id: String(safe(() => event.uid(), safe(() => event.id(), ''))), title: String(safe(() => event.summary(), 'Untitled event')),
  group: String(safe(() => calendar.name(), '')), text: String(safe(() => event.description(), '')),
  startsAt: time(safe(() => event.startDate(), null)), endsAt: time(safe(() => event.endDate(), null)),
  modifiedAt: time(safe(() => event.stampDate(), null))
}))).filter((row) => row.id && row.startsAt && row.startsAt >= min && row.startsAt <= max)
  .sort((a, b) => Math.abs(a.startsAt - now) - Math.abs(b.startsAt - now)).slice(0, ${APPLE_DEFAULT_LIMIT});
JSON.stringify(rows);`;

  return `${JXA_HELPERS}
const app = Application('Reminders');
const now = Date.now(); const min = now - 60 * 86400000;
const rows = safe(() => app.lists(), []).flatMap((list) => safe(() => list.reminders(), []).map((reminder) => ({
  id: String(safe(() => reminder.id(), '')), title: String(safe(() => reminder.name(), 'Untitled reminder')),
  group: String(safe(() => list.name(), '')), text: String(safe(() => reminder.body(), '')),
  occurredAt: time(safe(() => reminder.creationDate(), null)), modifiedAt: time(safe(() => reminder.modificationDate(), null)),
  startsAt: time(safe(() => reminder.dueDate(), null)), completedAt: time(safe(() => reminder.completionDate(), null)),
  completed: safe(() => reminder.completed(), false) === true
}))).filter((row) => row.id && (!row.completed || (row.completedAt || 0) >= min))
  .sort((a, b) => (b.modifiedAt || b.occurredAt || 0) - (a.modifiedAt || a.occurredAt || 0)).slice(0, ${APPLE_DEFAULT_LIMIT});
JSON.stringify(rows);`;
}

function execText(command: string, args: string[], timeout = JXA_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => execFile(command, args, {
    timeout, maxBuffer: 6 * 1024 * 1024, encoding: 'utf8',
  }, (error, stdout) => (error ? reject(error) : resolve(stdout))));
}

function appleItemType(sourceId: Tier2LocalUnderstandingSourceId): UnderstandingSourceItem['type'] {
  if (sourceId === 'apple-mail') return 'mail';
  if (sourceId === 'apple-calendar') return 'calendar_event';
  if (sourceId === 'apple-reminders') return 'task';
  return 'note';
}

function normalizeAppleItems(sourceId: Tier2LocalUnderstandingSourceId, raw: unknown): UnderstandingSourceItem[] {
  if (!Array.isArray(raw)) return [];
  const limit = sourceId === 'apple-notes'
    ? APPLE_NOTES_LIMIT
    : sourceId === 'apple-mail'
      ? APPLE_MAIL_SENT_LIMIT + APPLE_MAIL_INBOX_LIMIT
      : APPLE_DEFAULT_LIMIT;
  let remaining = TOTAL_CHARS;
  return raw.flatMap((value) => {
    if (!value || typeof value !== 'object' || remaining <= 0) return [];
    const row = value as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim().slice(0, 500) : '';
    const title = typeof row.title === 'string' ? row.title.trim().slice(0, 300) : '';
    if (!id || !title) return [];
    const text = typeof row.text === 'string' ? row.text.trim().slice(0, Math.min(ITEM_CHARS, remaining)) : '';
    remaining -= text.length;
    const num = (key: string) => (typeof row[key] === 'number' && Number.isFinite(row[key]) ? row[key] as number : undefined);
    return [{
      id,
      sourceId,
      type: appleItemType(sourceId),
      title,
      ...(text ? { text } : {}),
      ...(typeof row.group === 'string' && row.group.trim() ? { group: row.group.trim().slice(0, 200) } : {}),
      ...(num('occurredAt') ? { occurredAt: num('occurredAt') } : {}),
      ...(num('modifiedAt') ? { modifiedAt: num('modifiedAt') } : {}),
      ...(num('startsAt') ? { startsAt: num('startsAt') } : {}),
      ...(num('endsAt') ? { endsAt: num('endsAt') } : {}),
      ownerAttribution: row.ownerAttribution === 'user' || row.ownerAttribution === 'other'
        ? row.ownerAttribution
        : sourceId === 'apple-calendar' ? 'unknown' : 'user',
      sensitivity: 'personal',
      evidenceRef: `${sourceId}://${encodeURIComponent(id)}`,
    } satisfies UnderstandingSourceItem];
  }).slice(0, limit);
}

async function collectAppleSource(sourceId: Tier2LocalUnderstandingSourceId): Promise<UnderstandingSourceCollectionResult> {
  try {
    const output = await execText('/usr/bin/osascript', ['-l', 'JavaScript', '-e', appleScript(sourceId)]);
    const items = normalizeAppleItems(sourceId, JSON.parse(output) as unknown);
    return {
      sourceId,
      status: 'completed',
      items,
      checkpoint: { fingerprint: fingerprintUnderstandingItems(items), collectedAt: Date.now() },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    const denied = lower.includes('not authorized') || lower.includes('permission') || lower.includes('-1743');
    return { sourceId, status: denied ? 'denied' : 'failed', items: [], error: message.slice(0, 500) };
  }
}

export interface UnderstandingCollectOptions {
  excludeIds: string[];
  customNoteDirectories: string[];
}

export function normalizeUnderstandingCollectOptions(value: unknown): UnderstandingCollectOptions {
  if (!value || typeof value !== 'object') return { excludeIds: [], customNoteDirectories: [] };
  const raw = value as Record<string, unknown>;
  const excludeIds = Array.isArray(raw.excludeIds)
    ? [...new Set(raw.excludeIds
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => /^[a-f0-9]{12,64}$/.test(entry)))]
      .slice(0, 64)
    : [];
  const customNoteDirectories = Array.isArray(raw.customNoteDirectories)
    ? [...new Set(raw.customNoteDirectories
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map((entry) => entry.trim().slice(0, 500)))]
      .slice(0, 10)
    : [];
  return { excludeIds, customNoteDirectories };
}

export function normalizeUnderstandingSourceIds(
  value: unknown,
  platform: Exclude<UnderstandingSourcePlatform, 'all'> = process.platform as Exclude<UnderstandingSourcePlatform, 'all'>,
): LocalUnderstandingSourceId[] {
  if (!Array.isArray(value)) return [];
  const available = new Set(listLocalUnderstandingSourceDefinitions(platform).map((source) => source.id));
  return [...new Set(value.filter((source): source is LocalUnderstandingSourceId => (
    typeof source === 'string' && isLocalUnderstandingSourceId(source) && available.has(source)
  )))];
}

export function registerUnderstandingSourcesIpc(ipcMain: IpcMain): void {
  ipcMain.handle('understanding-sources:catalog', (event) => {
    assertTrustedRenderer(event);
    return listLocalUnderstandingSourceDefinitions();
  });

  ipcMain.handle('understanding-sources:preview', async (event, rawOptions?: unknown) => {
    assertTrustedRenderer(event);
    const options = normalizeUnderstandingCollectOptions(rawOptions);
    return previewTier1Sources({ customNoteDirectories: options.customNoteDirectories });
  });

  ipcMain.handle('understanding-sources:collect', async (event, requestedSources: unknown, rawOptions?: unknown) => {
    assertTrustedRenderer(event);
    const options = normalizeUnderstandingCollectOptions(rawOptions);
    const sourceIds = normalizeUnderstandingSourceIds(requestedSources);
    const tier1Ids = sourceIds.filter(isTier1LocalSourceId);
    const tier2Ids = sourceIds.filter(isTier2LocalSourceId);

    // Tier 1 runs concurrently (zero OS prompts). Tier 2 runs serially so macOS permission dialogs never stack.
    const tier1Results = await Promise.all(
      tier1Ids.map((sourceId) => collectTier1Source(sourceId, {
        excludeIds: options.excludeIds,
        customNoteDirectories: options.customNoteDirectories,
      })),
    );
    const tier2Results: UnderstandingSourceCollectionResult[] = [];
    for (const sourceId of tier2Ids) {
      tier2Results.push(await collectAppleSource(sourceId));
    }

    const byId = new Map([...tier1Results, ...tier2Results].map((result) => [result.sourceId, result]));
    return sourceIds.map((id) => byId.get(id)!);
  });
}
