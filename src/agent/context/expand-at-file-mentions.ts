import { readdir, readFile, stat } from 'node:fs/promises';

import { resolveWorkspaceSafePath } from '../../gateway/workspace-editor-path.js';

const FILE_TOKEN_RE = /@file:([a-zA-Z0-9_./-]+)/g;

const MAX_BYTES = 50_000;
const MAX_DIR_ENTRIES = 120;

/**
 * Prepend `<file path="…">` blocks for each `@file:` reference so the model sees workspace content.
 * Paths are resolved under `workspaceRoot` (session effective workspace).
 */
export async function expandAtFileMentionsInPlainText(text: string, workspaceRoot: string): Promise<string> {
  if (!text.includes('@file:')) return text;
  const re = new RegExp(FILE_TOKEN_RE.source, 'g');
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) return text;

  const seen = new Set<string>();
  const blocks: string[] = [];

  for (const m of matches) {
    const rel = m[1]?.trim() ?? '';
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    const abs = resolveWorkspaceSafePath(workspaceRoot, rel);
    if (!abs) continue;

    let body: string;
    try {
      const st = await stat(abs);
      if (st.isDirectory()) {
        const entries = await readdir(abs, { withFileTypes: true });
        const lines = entries
          .filter((e) => !e.name.startsWith('.'))
          .slice(0, MAX_DIR_ENTRIES)
          .map((e) => `${e.isDirectory() ? '(dir)' : '(file)'} ${e.name}`)
          .join('\n');
        body = `[directory, first ${MAX_DIR_ENTRIES} non-hidden entries]\n${lines}`;
      } else if (st.isFile()) {
        const buf = await readFile(abs);
        const s = buf.toString('utf8');
        body = s.length > MAX_BYTES ? `${s.slice(0, MAX_BYTES)}\n\n[... truncated ...]` : s;
      } else {
        continue;
      }
    } catch {
      body = '[unreadable or missing]';
    }
    blocks.push(`<file path="${rel}">\n${body}\n</file>`);
  }

  if (blocks.length === 0) return text;
  return `${blocks.join('\n\n')}\n\n${text}`;
}
