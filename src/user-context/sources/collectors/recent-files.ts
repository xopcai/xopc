import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, relative } from 'node:path';

import { extractDocumentText } from '../../../document-understanding/extract.js';
import { resolvePersonalWorkRoots } from '../../../work-discovery/candidate-discovery.js';
import type { LocalSourcePreview, UnderstandingSourceItem } from '../types.js';

const SOURCE_ID = 'local-recent-files';
const MAX_ITEMS = 60;
const MAX_ENTRIES_PER_DIRECTORY = 250;
const MAX_DEPTH = 2;
const MAX_CONTENT_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ITEM_TEXT_CHARS = 8_000;
const MAX_TOTAL_TEXT_CHARS = 120_000;
const DAY_MS = 86_400_000;

const DOCUMENT_EXTENSIONS = new Set([
  '.csv', '.doc', '.docx', '.fig', '.key', '.md', '.numbers', '.odt', '.pages', '.pdf',
  '.ppt', '.pptx', '.rtf', '.sketch', '.txt', '.xls', '.xlsx',
]);
const AUTHORED_EXTENSIONS = new Set([
  '.md', '.txt', '.docx', '.doc', '.rtf', '.odt', '.pages', '.pptx', '.ppt', '.key',
]);
const NOISE_EXTENSIONS = new Set([
  '.7z', '.app', '.dmg', '.exe', '.gz', '.iso', '.msi', '.pkg', '.rar', '.tar', '.zip',
]);
const SECRET_NAME = /(?:^|[-_.])(credentials?|secrets?|tokens?|api[-_]?keys?|auth|passwords?)(?:[-_.]|$)|^\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i;

export interface RecentFilesCollectionOptions {
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  nowMs?: number;
  excludeIds?: string[];
}

function windowDays(rootName: string): number {
  const lower = rootName.toLocaleLowerCase();
  if (lower === 'downloads') return 14;
  if (lower === 'desktop') return 30;
  return 60;
}

function inferOwnerAttribution(rootName: string, extension: string): UnderstandingSourceItem['ownerAttribution'] {
  if (rootName.toLocaleLowerCase() === 'downloads') return 'unknown';
  return AUTHORED_EXTENSIONS.has(extension) ? 'user' : 'unknown';
}

function safeGroup(root: string, filePath: string): string {
  const parent = relative(root, dirname(filePath)).replaceAll('\\', '/');
  if (!parent || parent === '.') return basename(root);
  const area = createHash('sha256').update(parent).digest('hex').slice(0, 8);
  return `${basename(root)}/area-${area}`;
}

function itemId(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 24);
}

type CandidateFile = {
  item: UnderstandingSourceItem;
  modifiedAt: number;
  path: string;
  size: number;
  score: number;
};

async function scanRecentFiles(options: RecentFilesCollectionOptions): Promise<CandidateFile[]> {
  const homeDirectory = options.homeDirectory ?? homedir();
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const nowMs = options.nowMs ?? Date.now();
  const excludedPrefixes = (options.excludeIds ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length >= 12);
  const isExcluded = (id: string): boolean => (
    excludedPrefixes.length > 0 && excludedPrefixes.some((prefix) => id.startsWith(prefix) || prefix.startsWith(id))
  );
  const roots = await resolvePersonalWorkRoots(homeDirectory, platform, environment);
  const collected: CandidateFile[] = [];

  const visit = async (root: string, directory: string, depth: number): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const rootName = basename(root);
    for (const entry of entries.slice(0, MAX_ENTRIES_PER_DIRECTORY)) {
      if (entry.name.startsWith('.') || entry.name.endsWith('.icloud') || SECRET_NAME.test(entry.name)) continue;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) await visit(root, fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = extname(entry.name).toLocaleLowerCase();
      if (NOISE_EXTENSIONS.has(extension) || !DOCUMENT_EXTENSIONS.has(extension)) continue;
      const info = await stat(fullPath).catch(() => null);
      if (!info?.isFile() || nowMs - info.mtimeMs > windowDays(rootName) * DAY_MS) continue;
      const id = itemId(fullPath);
      if (isExcluded(id)) continue;
      const ownerAttribution = inferOwnerAttribution(rootName, extension);
      const ageDays = Math.max(0, (nowMs - info.mtimeMs) / DAY_MS);
      const recency = Math.exp(-ageDays / 21);
      const ownerWeight = ownerAttribution === 'user' ? 1.5 : 0.65;
      collected.push({
        modifiedAt: info.mtimeMs,
        path: fullPath,
        size: info.size,
        score: recency * ownerWeight,
        item: {
          id,
          sourceId: SOURCE_ID,
          type: 'document',
          title: entry.name.slice(0, 300),
          group: safeGroup(root, fullPath).slice(0, 200),
          modifiedAt: info.mtimeMs,
          ownerAttribution,
          sensitivity: 'personal',
          evidenceRef: `${SOURCE_ID}://${id}`,
        },
      });
    }
  };

  await Promise.all(roots.map((root) => visit(root, root, 0)));
  return collected.sort((left, right) => right.score - left.score || right.modifiedAt - left.modifiedAt);
}

export async function previewRecentFiles(
  options: RecentFilesCollectionOptions = {},
): Promise<LocalSourcePreview> {
  const candidates = await scanRecentFiles(options);
  return {
    sourceId: SOURCE_ID,
    detected: candidates.length > 0,
    itemCount: Math.min(candidates.length, MAX_ITEMS),
  };
}

export async function collectRecentFileItems(
  options: RecentFilesCollectionOptions = {},
): Promise<UnderstandingSourceItem[]> {
  const recent = (await scanRecentFiles(options)).slice(0, MAX_ITEMS);
  let remaining = MAX_TOTAL_TEXT_CHARS;
  const items: UnderstandingSourceItem[] = [];
  for (const candidate of recent) {
    let text = '';
    if (remaining > 0 && candidate.size <= MAX_CONTENT_FILE_BYTES) {
      const buffer = await readFile(candidate.path).catch(() => null);
      if (buffer) {
        const extracted = extractDocumentText({ buffer, fileName: candidate.item.title });
        if (extracted.ok) text = extracted.text.slice(0, Math.min(MAX_ITEM_TEXT_CHARS, remaining)).trim();
      }
    }
    remaining -= text.length;
    items.push({ ...candidate.item, ...(text ? { text } : {}) });
  }
  return items;
}
