import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import type { IpcMain } from 'electron';

import type {
  UnderstandingSourceCollectionResult,
  UnderstandingSourceDefinition,
  UnderstandingSourceItem,
} from '../../src/user-context/sources/types.js';
import {
  isLocalUnderstandingSourceId,
  type LocalUnderstandingSourceId,
} from '../../src/user-context/sources/local-source-contract.js';
import { collectRecentFileItems } from '../understanding-sources/recent-files.js';
import { collectChromiumBookmarkItems } from '../understanding-sources/chromium-bookmarks.js';
import { assertTrustedRenderer } from './trusted-renderer.js';

const SOURCE_LIMIT = 50;
const ITEM_CHARS = 12_000;
const TOTAL_CHARS = 300_000;
type LocalSourceId = LocalUnderstandingSourceId;

function localCatalog(platform = process.platform): UnderstandingSourceDefinition[] {
  const common = [
    definition('local-recent-files', 'recent_documents', 'Recent files', 'all', true, true),
    definition('chromium-bookmarks', 'recent_documents', 'Recent bookmarks', 'all', true, true),
  ];
  if (platform === 'darwin') return [...common,
    definition('apple-notes', 'notes', 'Apple Notes', 'darwin', true, false),
    definition('apple-calendar', 'calendar', 'Apple Calendar', 'darwin', true, true),
    definition('apple-reminders', 'tasks', 'Apple Reminders', 'darwin', true, true),
  ];
  if (platform === 'win32') return [...common,
    definition('windows-recent-documents', 'recent_documents', 'Recent documents', 'win32', false, true),
  ];
  if (platform === 'linux') return [...common,
    definition('linux-recent-documents', 'recent_documents', 'Recent documents', 'linux', false, true),
  ];
  return common;
}

function definition(
  id: string,
  category: UnderstandingSourceDefinition['category'],
  displayName: string,
  platform: UnderstandingSourceDefinition['platform'],
  sensitive: boolean,
  recommended: boolean,
): UnderstandingSourceDefinition {
  return {
    id, category, platform, displayName,
    description: category === 'recent_documents'
      ? 'Read-only metadata for recently used documents'
      : `Read-only ${displayName} context selected by the user`,
    availability: 'available', permission: sensitive ? 'not_requested' : 'granted',
    defaultAccessMode: 'once', supportedAccessModes: ['once'], recommended, sensitive,
  };
}

const JXA_HELPERS = `
const safe = (read, fallback) => { try { return read(); } catch (_) { return fallback; } };
const time = (value) => { const n = value ? new Date(value).getTime() : NaN; return Number.isFinite(n) ? n : undefined; };
`;

function appleScript(source: LocalSourceId): string {
  if (source === 'apple-notes') return `${JXA_HELPERS}
const app = Application('Notes');
const rows = safe(() => app.notes(), []).map((note) => {
  const locked = safe(() => note.passwordProtected(), false) === true;
  const container = safe(() => note.container(), null);
  return { id: String(safe(() => note.id(), '')), title: String(safe(() => note.name(), 'Untitled')),
    group: container ? String(safe(() => container.name(), '')) : '', text: locked ? '' : String(safe(() => note.plaintext(), '')),
    occurredAt: time(safe(() => note.creationDate(), null)), modifiedAt: time(safe(() => note.modificationDate(), null)) };
}).filter((row) => row.id && row.text).sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0)).slice(0, ${SOURCE_LIMIT});
JSON.stringify(rows);`;
  if (source === 'apple-calendar') return `${JXA_HELPERS}
const app = Application('Calendar');
const now = Date.now(); const min = now - 30 * 86400000; const max = now + 90 * 86400000;
const rows = safe(() => app.calendars(), []).flatMap((calendar) => safe(() => calendar.events(), []).map((event) => ({
  id: String(safe(() => event.uid(), safe(() => event.id(), ''))), title: String(safe(() => event.summary(), 'Untitled event')),
  group: String(safe(() => calendar.name(), '')), text: String(safe(() => event.description(), '')),
  startsAt: time(safe(() => event.startDate(), null)), endsAt: time(safe(() => event.endDate(), null)),
  modifiedAt: time(safe(() => event.stampDate(), null))
}))).filter((row) => row.id && row.startsAt && row.startsAt >= min && row.startsAt <= max)
  .sort((a, b) => Math.abs(a.startsAt - now) - Math.abs(b.startsAt - now)).slice(0, ${SOURCE_LIMIT});
JSON.stringify(rows);`;
  return `${JXA_HELPERS}
const app = Application('Reminders');
const now = Date.now(); const min = now - 90 * 86400000;
const rows = safe(() => app.lists(), []).flatMap((list) => safe(() => list.reminders(), []).map((reminder) => ({
  id: String(safe(() => reminder.id(), '')), title: String(safe(() => reminder.name(), 'Untitled reminder')),
  group: String(safe(() => list.name(), '')), text: String(safe(() => reminder.body(), '')),
  occurredAt: time(safe(() => reminder.creationDate(), null)), modifiedAt: time(safe(() => reminder.modificationDate(), null)),
  startsAt: time(safe(() => reminder.dueDate(), null)), completedAt: time(safe(() => reminder.completionDate(), null)),
  completed: safe(() => reminder.completed(), false) === true
}))).filter((row) => row.id && (!row.completed || (row.completedAt || 0) >= min))
  .sort((a, b) => (b.modifiedAt || b.occurredAt || 0) - (a.modifiedAt || a.occurredAt || 0)).slice(0, ${SOURCE_LIMIT});
JSON.stringify(rows);`;
}

function execText(command: string, args: string[], timeout = 25_000): Promise<string> {
  return new Promise((resolve, reject) => execFile(command, args, {
    timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8',
  }, (error, stdout) => error ? reject(error) : resolve(stdout)));
}

function itemType(sourceId: LocalSourceId): UnderstandingSourceItem['type'] {
  if (sourceId === 'apple-calendar') return 'calendar_event';
  if (sourceId === 'apple-reminders') return 'task';
  if (sourceId === 'apple-notes') return 'note';
  return 'document';
}

function normalize(sourceId: LocalSourceId, raw: unknown): UnderstandingSourceItem[] {
  if (!Array.isArray(raw)) return [];
  let remaining = TOTAL_CHARS;
  return raw.flatMap((value) => {
    if (!value || typeof value !== 'object' || remaining <= 0) return [];
    const row = value as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim().slice(0, 500) : '';
    const title = typeof row.title === 'string' ? row.title.trim().slice(0, 300) : '';
    if (!id || !title) return [];
    const text = typeof row.text === 'string' ? row.text.trim().slice(0, Math.min(ITEM_CHARS, remaining)) : '';
    remaining -= text.length;
    const number = (key: string) => typeof row[key] === 'number' && Number.isFinite(row[key]) ? row[key] as number : undefined;
    return [{
      id, sourceId, type: itemType(sourceId), title, ...(text ? { text } : {}),
      ...(typeof row.group === 'string' && row.group.trim() ? { group: row.group.trim().slice(0, 200) } : {}),
      ...(number('occurredAt') ? { occurredAt: number('occurredAt') } : {}),
      ...(number('modifiedAt') ? { modifiedAt: number('modifiedAt') } : {}),
      ...(number('startsAt') ? { startsAt: number('startsAt') } : {}),
      ...(number('endsAt') ? { endsAt: number('endsAt') } : {}),
      ownerAttribution: sourceId === 'apple-calendar' ? 'unknown' : 'user',
      sensitivity: sourceId.includes('recent-documents') ? 'normal' : 'personal',
      evidenceRef: `${sourceId}://${encodeURIComponent(id)}`,
    } satisfies UnderstandingSourceItem];
  }).slice(0, SOURCE_LIMIT);
}

async function collectApple(sourceId: LocalSourceId): Promise<UnderstandingSourceItem[]> {
  const output = await execText('/usr/bin/osascript', ['-l', 'JavaScript', '-e', appleScript(sourceId)]);
  return normalize(sourceId, JSON.parse(output) as unknown);
}

async function collectWindowsRecent(): Promise<UnderstandingSourceItem[]> {
  const script = `
$shell = New-Object -ComObject WScript.Shell
$folder = Join-Path $env:APPDATA 'Microsoft\\Windows\\Recent'
$items = Get-ChildItem -LiteralPath $folder -Filter *.lnk -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTimeUtc -Descending | Select-Object -First ${SOURCE_LIMIT} | ForEach-Object {
    $shortcut = $shell.CreateShortcut($_.FullName)
    [PSCustomObject]@{ id = $_.FullName; title = [IO.Path]::GetFileNameWithoutExtension($_.Name); target = $shortcut.TargetPath; modifiedAt = ([DateTimeOffset]$_.LastWriteTimeUtc).ToUnixTimeMilliseconds() }
  }
$items | ConvertTo-Json -Compress
`;
  const output = await execText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  const raw = output.trim() ? JSON.parse(output) as unknown : [];
  const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return normalize('windows-recent-documents', rows.map((value) => {
    const row = value as Record<string, unknown>;
    return { id: row.id, title: row.title, modifiedAt: row.modifiedAt, group: row.target };
  }));
}

function decodeXml(value: string): string {
  return value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>');
}

async function collectLinuxRecent(): Promise<UnderstandingSourceItem[]> {
  const path = join(homedir(), '.local', 'share', 'recently-used.xbel');
  const xml = await readFile(path, 'utf8').catch(() => '');
  const rows: Array<Record<string, unknown>> = [];
  for (const match of xml.matchAll(/<bookmark\s+([^>]*)>/g)) {
    const attributes = match[1] ?? '';
    const hrefValue = /\bhref="([^"]+)"/.exec(attributes)?.[1];
    if (!hrefValue) continue;
    const modified = /\bmodified="([^"]+)"/.exec(attributes)?.[1];
    const href = decodeXml(hrefValue);
    let filePath = href;
    try { if (href.startsWith('file://')) filePath = decodeURIComponent(new URL(href).pathname); } catch { /* keep URI */ }
    const info = filePath.startsWith('/') ? await stat(filePath).catch(() => null) : null;
    rows.push({
      id: href, title: basename(filePath) || href, group: filePath,
      modifiedAt: modified ? Date.parse(modified) : info?.mtimeMs,
    });
    if (rows.length >= SOURCE_LIMIT) break;
  }
  return normalize('linux-recent-documents', rows);
}

async function collectSource(sourceId: LocalSourceId): Promise<UnderstandingSourceCollectionResult> {
  try {
    let items: UnderstandingSourceItem[];
    if (sourceId === 'local-recent-files') items = await collectRecentFileItems();
    else if (sourceId === 'chromium-bookmarks') items = await collectChromiumBookmarkItems();
    else if (sourceId.startsWith('apple-')) items = await collectApple(sourceId);
    else if (sourceId === 'windows-recent-documents') items = await collectWindowsRecent();
    else items = await collectLinuxRecent();
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

export function fingerprintUnderstandingItems(items: UnderstandingSourceItem[]): string {
  const stable = items.map((item) => ({
    id: item.id,
    title: item.title,
    group: item.group ?? '',
    resourceUri: item.resourceUri ?? '',
    occurredAt: item.occurredAt ?? 0,
    modifiedAt: item.modifiedAt ?? 0,
    startsAt: item.startsAt ?? 0,
    endsAt: item.endsAt ?? 0,
  })).sort((left, right) => left.id.localeCompare(right.id));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

export function normalizeUnderstandingSourceIds(value: unknown, platform = process.platform): LocalSourceId[] {
  if (!Array.isArray(value)) return [];
  const available = new Set(localCatalog(platform).map((source) => source.id));
  return [...new Set(value.filter((source): source is LocalSourceId => (
    typeof source === 'string' && isLocalUnderstandingSourceId(source) && available.has(source)
  )))];
}

export function registerUnderstandingSourcesIpc(ipcMain: IpcMain): void {
  ipcMain.handle('understanding-sources:catalog', (event) => {
    assertTrustedRenderer(event);
    return localCatalog();
  });
  ipcMain.handle('understanding-sources:collect', async (event, requestedSources: unknown) => {
    assertTrustedRenderer(event);
    return Promise.all(normalizeUnderstandingSourceIds(requestedSources).map(collectSource));
  });
}
