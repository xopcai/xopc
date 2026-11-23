import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

import type { LocalSourcePreview, UnderstandingSourceItem } from '../types.js';

const SOURCE_ID = 'local-markdown-notes';
const MAX_SELECTED_ITEMS = 30;
const MAX_DEPTH = 4;
const MAX_ENTRIES_PER_DIR = 250;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_ITEM_CHARS = 8_000;
const MAX_TOTAL_CHARS = 80_000;
const DAY_MS = 86_400_000;
const WINDOW_DAYS = 180;

const NOTE_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
const SKIP_DIR_NAMES = new Set(['.git', '.obsidian', '.trash', 'node_modules', 'templates', 'attachments', 'assets']);
const SECRET_NAME = /(?:^|[-_.])(credentials?|secrets?|tokens?|api[-_]?keys?|passwords?|recovery)(?:[-_.]|$)|^\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i;
const CLIPPING_DIR_PATTERN = /(?:^|\/)(?:clippings?|readwise|kindle|bookmarks?)(?:\/|$)/i;
const FRONTMATTER_EXTERNAL = /^(?:url|source|source_url|clipped|author)\s*:/im;

export interface LocalMarkdownNotesCollectionOptions {
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  customDirectories?: string[];
  nowMs?: number;
  excludeIds?: string[];
}

function defaultNoteDirectories(home: string, platform: NodeJS.Platform): string[] {
  const dirs = [
    join(home, 'Notes'),
    join(home, 'Documents', 'Notes'),
    join(home, 'Documents', 'Logseq', 'pages'),
    join(home, 'Documents', 'Logseq', 'journals'),
    join(home, 'Documents', 'Bear'),
  ];
  if (platform === 'darwin') {
    dirs.push(join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Notes'));
  }
  return dirs;
}

async function resolveExistingNoteRoots(
  home: string,
  platform: NodeJS.Platform,
  customDirectories: string[] = [],
): Promise<string[]> {
  const candidates = [
    ...customDirectories.map((dir) => resolve(dir)),
    ...defaultNoteDirectories(home, platform),
  ];
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const dir of candidates) {
    if (seen.has(dir)) continue;
    const info = await stat(dir).catch(() => null);
    if (!info?.isDirectory()) continue;
    // Skip directories that are Obsidian vaults (handled by local-obsidian).
    const obsidianDir = await stat(join(dir, '.obsidian')).catch(() => null);
    if (obsidianDir?.isDirectory()) continue;
    seen.add(dir);
    roots.push(dir);
  }
  return roots;
}

function noteId(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 24);
}

type CandidateNote = {
  id: string;
  rootName: string;
  title: string;
  relPath: string;
  fullPath: string;
  modifiedAt: number;
};

async function scanRoot(root: string, nowMs: number, excluded: Set<string>): Promise<CandidateNote[]> {
  const rootName = basename(root) || 'Notes';
  const notes: CandidateNote[] = [];
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
      if (!entry.isFile() || !NOTE_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase())) continue;
      const info = await stat(fullPath).catch(() => null);
      if (!info?.isFile() || info.size < 40 || info.size > MAX_FILE_BYTES) continue;
      if (nowMs - info.mtimeMs > WINDOW_DAYS * DAY_MS) continue;
      const id = noteId(fullPath);
      if (excluded.has(id)) continue;
      notes.push({
        id,
        rootName,
        title: entry.name.replace(/\.(?:md|markdown|txt)$/i, '').slice(0, 300),
        relPath: relative(root, fullPath).replaceAll('\\', '/'),
        fullPath,
        modifiedAt: info.mtimeMs,
      });
    }
  };
  await visit(root, 0);
  return notes;
}

export async function previewLocalMarkdownNotes(
  options: LocalMarkdownNotesCollectionOptions = {},
): Promise<LocalSourcePreview> {
  const home = options.homeDirectory ?? homedir();
  const platform = options.platform ?? process.platform;
  const nowMs = options.nowMs ?? Date.now();
  const roots = await resolveExistingNoteRoots(home, platform, options.customDirectories);
  if (!roots.length) return { sourceId: SOURCE_ID, detected: false, itemCount: 0 };
  const scanned = (await Promise.all(roots.map((root) => scanRoot(root, nowMs, new Set())))).flat();
  return {
    sourceId: SOURCE_ID,
    detected: scanned.length > 0,
    itemCount: scanned.length,
    summary: roots.map((root) => basename(root)).slice(0, 2).join(' · '),
  };
}

export async function collectLocalMarkdownNoteItems(
  options: LocalMarkdownNotesCollectionOptions = {},
): Promise<UnderstandingSourceItem[]> {
  const home = options.homeDirectory ?? homedir();
  const platform = options.platform ?? process.platform;
  const nowMs = options.nowMs ?? Date.now();
  const excluded = new Set((options.excludeIds ?? []).map((id) => id.trim().toLowerCase()));
  const roots = await resolveExistingNoteRoots(home, platform, options.customDirectories);
  if (!roots.length) return [];

  const candidates = (await Promise.all(roots.map((root) => scanRoot(root, nowMs, excluded))))
    .flat()
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(0, MAX_SELECTED_ITEMS * 2);

  let remaining = MAX_TOTAL_CHARS;
  const items: UnderstandingSourceItem[] = [];
  for (const candidate of candidates) {
    if (items.length >= MAX_SELECTED_ITEMS || remaining <= 0) break;
    const raw = await readFile(candidate.fullPath, 'utf8').catch(() => '');
    const text = raw.trim().slice(0, Math.min(MAX_ITEM_CHARS, remaining));
    if (text.length < 40) continue;
    remaining -= text.length;
    const isClipping = CLIPPING_DIR_PATTERN.test(candidate.relPath)
      || (text.startsWith('---') && FRONTMATTER_EXTERNAL.test(text.slice(0, Math.max(0, text.indexOf('\n---', 3)))));
    const folder = dirname(candidate.relPath);
    const group = folder && folder !== '.'
      ? `${candidate.rootName}/${folder}`.slice(0, 200)
      : candidate.rootName.slice(0, 200);
    items.push({
      id: candidate.id,
      sourceId: SOURCE_ID,
      type: 'note',
      title: candidate.title,
      group,
      text,
      modifiedAt: candidate.modifiedAt,
      ownerAttribution: isClipping ? 'other' : 'user',
      sensitivity: 'personal',
      evidenceRef: `${SOURCE_ID}://${candidate.id}`,
    });
  }
  return items;
}
