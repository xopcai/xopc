import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';

import type { LocalSourcePreview, UnderstandingSourceItem } from '../types.js';

const SOURCE_ID = 'local-ai-instructions';
const MAX_ITEMS = 25;
const MAX_ITEM_CHARS = 12_000;
const MAX_TOTAL_CHARS = 60_000;
const MAX_FILE_BYTES = 256 * 1024;
const SECRET_FILE = /(?:^|[-_.])(credentials?|secrets?|tokens?|api[-_]?keys?|auth)(?:[-_.]|$)|^\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i;
const RULE_EXTENSIONS = new Set(['.md', '.mdc', '.txt']);

export interface AiInstructionsCollectionOptions {
  homeDirectory?: string;
}

type InstructionTarget =
  | { kind: 'file'; path: string; group: string }
  | { kind: 'dir'; path: string; group: string };

function globalInstructionTargets(home: string): InstructionTarget[] {
  return [
    { kind: 'file', path: join(home, '.claude', 'CLAUDE.md'), group: 'Claude' },
    { kind: 'dir', path: join(home, '.claude', 'rules'), group: 'Claude Rules' },
    { kind: 'file', path: join(home, '.codex', 'AGENTS.md'), group: 'Codex' },
    { kind: 'file', path: join(home, '.codex', 'instructions.md'), group: 'Codex' },
    { kind: 'dir', path: join(home, '.cursor', 'rules'), group: 'Cursor Rules' },
    { kind: 'file', path: join(home, '.gemini', 'GEMINI.md'), group: 'Gemini' },
  ];
}

function itemId(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 24);
}

async function resolveInstructionFiles(home: string): Promise<Array<{ path: string; group: string; modifiedAt: number; size: number }>> {
  const discovered: Array<{ path: string; group: string; modifiedAt: number; size: number }> = [];
  for (const target of globalInstructionTargets(home)) {
    if (target.kind === 'file') {
      const info = await stat(target.path).catch(() => null);
      if (!info?.isFile() || info.size === 0 || info.size > MAX_FILE_BYTES) continue;
      discovered.push({ path: target.path, group: target.group, modifiedAt: info.mtimeMs, size: info.size });
      continue;
    }
    const entries = await readdir(target.path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.slice(0, 50)) {
      if (!entry.isFile() || entry.name.startsWith('.') || SECRET_FILE.test(entry.name)) continue;
      if (!RULE_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase())) continue;
      const fullPath = join(target.path, entry.name);
      const info = await stat(fullPath).catch(() => null);
      if (!info?.isFile() || info.size === 0 || info.size > MAX_FILE_BYTES) continue;
      discovered.push({ path: fullPath, group: target.group, modifiedAt: info.mtimeMs, size: info.size });
    }
  }
  return discovered
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(0, MAX_ITEMS);
}

export async function previewAiInstructionFiles(
  options: AiInstructionsCollectionOptions = {},
): Promise<LocalSourcePreview> {
  const home = options.homeDirectory ?? homedir();
  const files = await resolveInstructionFiles(home);
  const groups = [...new Set(files.map((file) => file.group))];
  return {
    sourceId: SOURCE_ID,
    detected: files.length > 0,
    itemCount: files.length,
    ...(groups.length ? { summary: groups.join(' · ') } : {}),
  };
}

export async function collectAiInstructionItems(
  options: AiInstructionsCollectionOptions = {},
): Promise<UnderstandingSourceItem[]> {
  const home = options.homeDirectory ?? homedir();
  const files = await resolveInstructionFiles(home);
  let remaining = MAX_TOTAL_CHARS;
  const items: UnderstandingSourceItem[] = [];
  for (const file of files) {
    if (remaining <= 0) break;
    const raw = await readFile(file.path, 'utf8').catch(() => '');
    const text = raw.trim().slice(0, Math.min(MAX_ITEM_CHARS, remaining));
    if (text.length < 20) continue;
    remaining -= text.length;
    const id = itemId(file.path);
    items.push({
      id,
      sourceId: SOURCE_ID,
      type: 'note',
      title: `${file.group}: ${basename(file.path)}`.slice(0, 300),
      group: file.group,
      text,
      modifiedAt: file.modifiedAt,
      ownerAttribution: 'user',
      sensitivity: 'normal',
      evidenceRef: `${SOURCE_ID}://${id}`,
    });
  }
  return items;
}
