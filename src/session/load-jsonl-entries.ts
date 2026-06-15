import { existsSync, readFileSync } from 'node:fs';

import type { FileEntry } from '@earendil-works/pi-coding-agent';

/** Same semantics as pi-coding-agent `loadEntriesFromFile` (package does not export it from the root). */
export function loadEntriesFromFile(filePath: string): FileEntry[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const content = readFileSync(filePath, 'utf8');
  const entries: FileEntry[] = [];
  for (const line of content.trim().split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      entries.push(JSON.parse(line) as FileEntry);
    } catch {
      // Skip malformed lines (matches upstream)
    }
  }
  if (entries.length === 0) {
    return entries;
  }
  const header = entries[0];
  if (header.type !== 'session' || typeof (header as { id?: unknown }).id !== 'string') {
    return [];
  }
  return entries;
}
