import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, relative } from 'node:path';

import type { LocalSourcePreview, UnderstandingSourceItem } from '../types.js';

const SOURCE_ID = 'local-obsidian';
const MAX_VAULTS = 6;
const MAX_SCAN_CANDIDATES = 150;
const MAX_SELECTED_ITEMS = 35;
const MAX_DEPTH = 5;
const MAX_ENTRIES_PER_DIR = 300;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_ITEM_CHARS = 8_000;
const MAX_TOTAL_CHARS = 100_000;
const DAY_MS = 86_400_000;
const WINDOW_DAYS = 180;

const SKIP_DIR_NAMES = new Set([
  '.obsidian', '.git', '.trash', 'node_modules', 'templates', 'template',
  'attachments', 'assets', 'images', 'media', 'excalidraw',
]);
const CLIPPING_DIR_PATTERN = /(?:^|\/)(?:clippings?|web[-_ ]?clipper|readwise|kindle|literature|articles?|bookmarks?|inbox[-_ ]?clips?)(?:\/|$)/i;
const SECRET_NAME = /(?:^|[-_.])(credentials?|secrets?|tokens?|api[-_]?keys?|passwords?|recovery|seed[-_]?phrase)(?:[-_.]|$)|^\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i;
const FRONTMATTER_EXTERNAL = /^(?:url|source|source_url|clipped|clipped_at|author|published|readwise_url)\s*:/im;
const WIKILINK_REGEX = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

export interface ObsidianCollectionOptions {
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  nowMs?: number;
  excludeIds?: string[];
}

type VaultInfo = { name: string; path: string };

function obsidianConfigPaths(home: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'darwin') {
    return [join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json')];
  }
  if (platform === 'win32') {
    const appData = env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return [join(appData, 'obsidian', 'obsidian.json')];
  }
  const configHome = env.XDG_CONFIG_HOME ?? join(home, '.config');
  return [
    join(configHome, 'obsidian', 'obsidian.json'),
    join(home, '.var', 'app', 'md.obsidian.Obsidian', 'config', 'obsidian', 'obsidian.json'),
    join(home, 'snap', 'obsidian', 'current', '.config', 'obsidian', 'obsidian.json'),
  ];
}

async function discoverObsidianVaults(
  home: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): Promise<VaultInfo[]> {
  const vaults: VaultInfo[] = [];
  const seen = new Set<string>();
  for (const configPath of obsidianConfigPaths(home, platform, env)) {
    const raw = await readFile(configPath, 'utf8').catch(() => '');
    if (!raw) continue;
    let parsed: { vaults?: Record<string, { path?: string; ts?: number }> };
    try {
      parsed = JSON.parse(raw) as { vaults?: Record<string, { path?: string; ts?: number }> };
    } catch {
      continue;
    }
    const entries = Object.values(parsed.vaults ?? {})
      .filter((entry): entry is { path: string; ts?: number } => typeof entry?.path === 'string' && entry.path.trim().length > 0)
      .sort((left, right) => (right.ts ?? 0) - (left.ts ?? 0));
    for (const entry of entries) {
      const vaultPath = entry.path.trim();
      if (seen.has(vaultPath)) continue;
      const info = await stat(vaultPath).catch(() => null);
      if (!info?.isDirectory()) continue;
      seen.add(vaultPath);
      vaults.push({ name: basename(vaultPath) || 'Vault', path: vaultPath });
      if (vaults.length >= MAX_VAULTS) return vaults;
    }
  }
  return vaults;
}

function noteId(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 24);
}

function isExternalClipping(relPath: string, text: string): boolean {
  if (CLIPPING_DIR_PATTERN.test(relPath.replaceAll('\\', '/'))) return true;
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end > 0 && FRONTMATTER_EXTERNAL.test(text.slice(0, end))) return true;
  }
  return false;
}

function lengthScore(charLength: number): number {
  if (charLength < 80) return 0.25;
  if (charLength <= 4_000) return 1.0;
  if (charLength <= 10_000) return 0.8;
  return 0.55;
}

type ScannedNote = {
  id: string;
  vaultName: string;
  title: string;
  relPath: string;
  fullPath: string;
  modifiedAt: number;
  size: number;
};

async function scanVaultNotes(vault: VaultInfo, nowMs: number, excluded: Set<string>): Promise<ScannedNote[]> {
  const notes: ScannedNote[] = [];
  const visit = async (dir: string, depth: number): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.slice(0, MAX_ENTRIES_PER_DIR)) {
      if (entry.name.startsWith('.') || entry.name.endsWith('.icloud') || SECRET_NAME.test(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name.toLocaleLowerCase())) continue;
        if (depth < MAX_DEPTH) await visit(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || extname(entry.name).toLocaleLowerCase() !== '.md') continue;
      const info = await stat(fullPath).catch(() => null);
      if (!info?.isFile() || info.size < 40 || info.size > MAX_FILE_BYTES) continue;
      if (nowMs - info.mtimeMs > WINDOW_DAYS * DAY_MS) continue;
      const id = noteId(fullPath);
      if (excluded.has(id)) continue;
      const relPath = relative(vault.path, fullPath).replaceAll('\\', '/');
      notes.push({
        id,
        vaultName: vault.name,
        title: entry.name.replace(/\.md$/i, '').slice(0, 300),
        relPath,
        fullPath,
        modifiedAt: info.mtimeMs,
        size: info.size,
      });
    }
  };
  await visit(vault.path, 0);
  return notes;
}

export async function previewObsidianVaults(
  options: ObsidianCollectionOptions = {},
): Promise<LocalSourcePreview> {
  const home = options.homeDirectory ?? homedir();
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const nowMs = options.nowMs ?? Date.now();
  const vaults = await discoverObsidianVaults(home, platform, environment);
  if (!vaults.length) return { sourceId: SOURCE_ID, detected: false, itemCount: 0 };
  const scanned = (await Promise.all(vaults.map((vault) => scanVaultNotes(vault, nowMs, new Set())))).flat();
  const vaultLabel = vaults.length === 1 ? vaults[0]!.name : `${vaults.length} vaults`;
  return {
    sourceId: SOURCE_ID,
    detected: scanned.length > 0,
    itemCount: scanned.length,
    summary: vaultLabel,
  };
}

export async function collectObsidianItems(
  options: ObsidianCollectionOptions = {},
): Promise<UnderstandingSourceItem[]> {
  const home = options.homeDirectory ?? homedir();
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const nowMs = options.nowMs ?? Date.now();
  const excluded = new Set((options.excludeIds ?? []).map((id) => id.trim().toLowerCase()));
  const vaults = await discoverObsidianVaults(home, platform, environment);
  if (!vaults.length) return [];

  const allNotes = (await Promise.all(vaults.map((vault) => scanVaultNotes(vault, nowMs, excluded))))
    .flat()
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(0, MAX_SCAN_CANDIDATES);

  const loaded: Array<{
    note: ScannedNote;
    text: string;
    ownerAttribution: 'user' | 'other';
  }> = [];
  const backlinkCounts = new Map<string, number>();

  for (const note of allNotes) {
    const raw = await readFile(note.fullPath, 'utf8').catch(() => '');
    const text = raw.trim();
    if (text.length < 40) continue;
    const ownerAttribution = isExternalClipping(note.relPath, text) ? 'other' : 'user';
    for (const match of text.matchAll(WIKILINK_REGEX)) {
      const target = match[1]?.trim().toLocaleLowerCase();
      if (target) backlinkCounts.set(target, (backlinkCounts.get(target) ?? 0) + 1);
    }
    loaded.push({ note, text, ownerAttribution });
  }

  const ranked = loaded
    .map((entry) => {
      const ageDays = Math.max(0, (nowMs - entry.note.modifiedAt) / DAY_MS);
      const recency = Math.exp(-ageDays / 45);
      const links = backlinkCounts.get(entry.note.title.toLocaleLowerCase()) ?? 0;
      const hubBoost = 1 + Math.min(links, 6) * 0.12;
      const ownerBoost = entry.ownerAttribution === 'user' ? 1.4 : 0.65;
      const score = recency * lengthScore(entry.text.length) * hubBoost * ownerBoost;
      return { ...entry, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_SELECTED_ITEMS);

  let remaining = MAX_TOTAL_CHARS;
  const items: UnderstandingSourceItem[] = [];
  for (const entry of ranked) {
    if (remaining <= 0) break;
    const text = entry.text.slice(0, Math.min(MAX_ITEM_CHARS, remaining));
    remaining -= text.length;
    const folder = dirname(entry.note.relPath);
    const group = folder && folder !== '.'
      ? `${entry.note.vaultName}/${folder}`.slice(0, 200)
      : entry.note.vaultName.slice(0, 200);
    items.push({
      id: entry.note.id,
      sourceId: SOURCE_ID,
      type: 'note',
      title: entry.note.title,
      group,
      text,
      modifiedAt: entry.note.modifiedAt,
      ownerAttribution: entry.ownerAttribution,
      sensitivity: 'personal',
      evidenceRef: `${SOURCE_ID}://${entry.note.id}`,
    });
  }
  return items;
}
