import { execFile } from 'node:child_process';

import type { IpcMain } from 'electron';

import { assertTrustedRenderer } from './trusted-renderer.js';

export type PersonalContextSource = 'apple_notes' | 'calendar' | 'reminders';

const PERSONAL_CONTEXT_SOURCES = ['apple_notes', 'calendar', 'reminders'] as const;

export interface PersonalContextItem {
  id: string;
  source: PersonalContextSource;
  title: string;
  group?: string;
  content: string;
  createdAt?: number;
  modifiedAt?: number;
  startsAt?: number;
  endsAt?: number;
}

export interface PersonalContextSourceResult {
  source: PersonalContextSource;
  status: 'completed' | 'denied' | 'failed';
  items: PersonalContextItem[];
}

const SOURCE_LIMIT = 50;
const ITEM_CHARS = 12_000;
const TOTAL_CHARS = 300_000;

function scriptFor(source: PersonalContextSource): string {
  const helpers = `
const safe = (read, fallback) => { try { return read(); } catch (_) { return fallback; } };
const time = (value) => { const n = value ? new Date(value).getTime() : NaN; return Number.isFinite(n) ? n : undefined; };
`;
  if (source === 'apple_notes') {
    return `${helpers}
const app = Application('Notes');
const rows = safe(() => app.notes(), []).map((note) => {
  const locked = safe(() => note.passwordProtected(), false) === true;
  const container = safe(() => note.container(), null);
  return { id: String(safe(() => note.id(), '')), title: String(safe(() => note.name(), 'Untitled')),
    group: container ? String(safe(() => container.name(), '')) : '', content: locked ? '' : String(safe(() => note.plaintext(), '')),
    createdAt: time(safe(() => note.creationDate(), null)), modifiedAt: time(safe(() => note.modificationDate(), null)) };
}).filter((row) => row.id && row.content).sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0)).slice(0, ${SOURCE_LIMIT});
JSON.stringify(rows);`;
  }
  if (source === 'calendar') {
    return `${helpers}
const app = Application('Calendar');
const now = Date.now(); const min = now - 30 * 86400000; const max = now + 90 * 86400000;
const rows = safe(() => app.calendars(), []).flatMap((calendar) => safe(() => calendar.events(), []).map((event) => ({
  id: String(safe(() => event.uid(), safe(() => event.id(), ''))), title: String(safe(() => event.summary(), 'Untitled event')),
  group: String(safe(() => calendar.name(), '')), content: String(safe(() => event.description(), '')),
  startsAt: time(safe(() => event.startDate(), null)), endsAt: time(safe(() => event.endDate(), null)),
  modifiedAt: time(safe(() => event.stampDate(), null))
}))).filter((row) => row.id && row.startsAt && row.startsAt >= min && row.startsAt <= max)
  .sort((a, b) => Math.abs(a.startsAt - now) - Math.abs(b.startsAt - now)).slice(0, ${SOURCE_LIMIT});
JSON.stringify(rows);`;
  }
  return `${helpers}
const app = Application('Reminders');
const now = Date.now(); const min = now - 90 * 86400000;
const rows = safe(() => app.lists(), []).flatMap((list) => safe(() => list.reminders(), []).map((reminder) => ({
  id: String(safe(() => reminder.id(), '')), title: String(safe(() => reminder.name(), 'Untitled reminder')),
  group: String(safe(() => list.name(), '')), content: String(safe(() => reminder.body(), '')),
  createdAt: time(safe(() => reminder.creationDate(), null)), modifiedAt: time(safe(() => reminder.modificationDate(), null)),
  startsAt: time(safe(() => reminder.dueDate(), null)), completedAt: time(safe(() => reminder.completionDate(), null)),
  completed: safe(() => reminder.completed(), false) === true
}))).filter((row) => row.id && (!row.completed || (row.completedAt || 0) >= min))
  .sort((a, b) => (b.modifiedAt || b.createdAt || 0) - (a.modifiedAt || a.createdAt || 0)).slice(0, ${SOURCE_LIMIT});
JSON.stringify(rows);`;
}

function runJxa(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], {
      timeout: 25_000,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8',
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

function normalize(source: PersonalContextSource, raw: unknown): PersonalContextItem[] {
  if (!Array.isArray(raw)) return [];
  let remaining = TOTAL_CHARS;
  return raw.flatMap((value) => {
    if (!value || typeof value !== 'object' || remaining <= 0) return [];
    const row = value as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim().slice(0, 500) : '';
    const title = typeof row.title === 'string' ? row.title.trim().slice(0, 300) : '';
    if (!id || !title) return [];
    const content = typeof row.content === 'string'
      ? row.content.trim().slice(0, Math.min(ITEM_CHARS, remaining))
      : '';
    remaining -= content.length;
    const number = (key: string) => typeof row[key] === 'number' && Number.isFinite(row[key]) ? row[key] as number : undefined;
    return [{
      id,
      source,
      title,
      ...(typeof row.group === 'string' && row.group.trim() ? { group: row.group.trim().slice(0, 200) } : {}),
      content,
      ...(number('createdAt') ? { createdAt: number('createdAt') } : {}),
      ...(number('modifiedAt') ? { modifiedAt: number('modifiedAt') } : {}),
      ...(number('startsAt') ? { startsAt: number('startsAt') } : {}),
      ...(number('endsAt') ? { endsAt: number('endsAt') } : {}),
    }];
  }).slice(0, SOURCE_LIMIT);
}

async function scanSource(source: PersonalContextSource): Promise<PersonalContextSourceResult> {
  try {
    const items = normalize(source, JSON.parse(await runJxa(scriptFor(source))) as unknown);
    return { source, status: 'completed', items };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    const denied = message.includes('not authorized') || message.includes('permission') || message.includes('-1743');
    return { source, status: denied ? 'denied' : 'failed', items: [] };
  }
}

export function normalizePersonalContextSources(value: unknown): PersonalContextSource[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(PERSONAL_CONTEXT_SOURCES);
  return [...new Set(value.filter((source): source is PersonalContextSource => (
    typeof source === 'string' && allowed.has(source)
  )))];
}

export function registerPersonalContextIpc(ipcMain: IpcMain): void {
  ipcMain.handle('personal-context:scan', async (event, requestedSources: unknown) => {
    assertTrustedRenderer(event);
    if (process.platform !== 'darwin') return [] satisfies PersonalContextSourceResult[];
    return Promise.all(normalizePersonalContextSources(requestedSources).map(scanSource));
  });
}
