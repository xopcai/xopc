import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, relative } from 'node:path';

import { resolvePersonalWorkRoots } from '../../src/work-discovery/candidate-discovery.js';
import type { UnderstandingSourceItem } from '../../src/user-context/sources/types.js';

const SOURCE_ID = 'local-recent-files';
const MAX_ITEMS = 200;
const MAX_ENTRIES_PER_DIRECTORY = 250;
const MAX_DEPTH = 2;
const DAY_MS = 86_400_000;

const DOCUMENT_EXTENSIONS = new Set([
  '.csv', '.doc', '.docx', '.fig', '.key', '.md', '.numbers', '.odt', '.pages', '.pdf',
  '.ppt', '.pptx', '.rtf', '.sketch', '.txt', '.xls', '.xlsx',
]);
const NOISE_EXTENSIONS = new Set([
  '.7z', '.app', '.dmg', '.exe', '.gz', '.iso', '.msi', '.pkg', '.rar', '.tar', '.zip',
]);
const SECRET_NAME = /(?:^|[-_.])(credentials?|secrets?|tokens?|api[-_]?keys?|auth)(?:[-_.]|$)|^\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i;

export interface RecentFilesCollectionOptions {
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  nowMs?: number;
}

function windowDays(rootName: string): number {
  if (rootName.toLocaleLowerCase() === 'downloads') return 14;
  if (rootName.toLocaleLowerCase() === 'desktop') return 30;
  return 60;
}

function safeGroup(root: string, path: string): string {
  const parent = relative(root, dirname(path)).replaceAll('\\', '/');
  if (!parent || parent === '.') return basename(root);
  const area = createHash('sha256').update(parent).digest('hex').slice(0, 8);
  return `${basename(root)}/area-${area}`;
}

function itemId(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 24);
}

export async function collectRecentFileItems(
  options: RecentFilesCollectionOptions = {},
): Promise<UnderstandingSourceItem[]> {
  const homeDirectory = options.homeDirectory ?? homedir();
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const nowMs = options.nowMs ?? Date.now();
  const roots = await resolvePersonalWorkRoots(homeDirectory, platform, environment);
  const collected: Array<{ item: UnderstandingSourceItem; modifiedAt: number }> = [];

  const visit = async (root: string, directory: string, depth: number): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.slice(0, MAX_ENTRIES_PER_DIRECTORY)) {
      if (entry.name.startsWith('.') || SECRET_NAME.test(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) await visit(root, path, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = extname(entry.name).toLocaleLowerCase();
      if (NOISE_EXTENSIONS.has(extension) || !DOCUMENT_EXTENSIONS.has(extension)) continue;
      const info = await stat(path).catch(() => null);
      if (!info?.isFile() || nowMs - info.mtimeMs > windowDays(basename(root)) * DAY_MS) continue;
      const id = itemId(path);
      collected.push({
        modifiedAt: info.mtimeMs,
        item: {
          id,
          sourceId: SOURCE_ID,
          type: 'document',
          title: entry.name.slice(0, 300),
          group: safeGroup(root, path).slice(0, 200),
          modifiedAt: info.mtimeMs,
          ownerAttribution: 'user',
          sensitivity: 'personal',
          evidenceRef: `${SOURCE_ID}://${id}`,
        },
      });
    }
  };

  await Promise.all(roots.map((root) => visit(root, root, 0)));
  return collected
    .sort((left, right) => right.modifiedAt - left.modifiedAt || left.item.title.localeCompare(right.item.title))
    .slice(0, MAX_ITEMS)
    .map(({ item }) => item);
}
