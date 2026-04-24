import { readFile, readdir, stat } from 'node:fs/promises';

import { resolveWorkspaceSafePath } from '../../gateway/workspace-editor-path.js';

/** Aligned with web `file-wire-pattern.ts`: unquoted path or quoted for spaces. */
const QUOTED_INNER = String.raw`((?:[^"\\]|\\.)*)`;
const UNQUOTED = String.raw`[a-zA-Z0-9_./\-\p{L}\p{N}]+`;
const FILE_RE = new RegExp(`@file:(?:"${QUOTED_INNER}"|(${UNQUOTED}))`, 'gu');

const MAX_PATH_BYTES = 50_000;
const MAX_DIR_ENTRIES = 120;

interface TokenHit {
  start: number;
  end: number;
  value: string;
}

function pathFromFileWireExec(m: RegExpExecArray): string {
  const unquoted = m[2];
  if (unquoted != null && unquoted !== '') return unquoted;
  const q = m[1];
  return q != null ? q.replace(/\\(.)/g, (_: string, ch: string) => ch) : '';
}

function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function collectFileTokens(text: string): TokenHit[] {
  const out: TokenHit[] = [];
  const r = new RegExp(FILE_RE.source, 'gu');
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) {
    const v = pathFromFileWireExec(m).trim();
    if (v) out.push({ start: m.index, end: m.index + m[0].length, value: v });
  }
  return out;
}

async function workspacePathSnippet(rel: string, workspaceRoot: string): Promise<string> {
  const abs = resolveWorkspaceSafePath(workspaceRoot, rel);
  if (!abs) return '[invalid path]';
  try {
    const st = await stat(abs);
    if (st.isDirectory()) {
      const entries = await readdir(abs, { withFileTypes: true });
      const lines = entries
        .filter((e) => !e.name.startsWith('.'))
        .slice(0, MAX_DIR_ENTRIES)
        .map((e) => `${e.isDirectory() ? '(dir)' : '(file)'} ${e.name}`)
        .join('\n');
      return `[directory, first ${MAX_DIR_ENTRIES} non-hidden entries]\n${lines}`;
    }
    if (st.isFile()) {
      const buf = await readFile(abs);
      const s = buf.toString('utf8');
      return s.length > MAX_PATH_BYTES ? `${s.slice(0, MAX_PATH_BYTES)}\n\n[... truncated ...]` : s;
    }
    return '[not a file or directory]';
  } catch {
    return '[unreadable or missing]';
  }
}

/**
 * Prepend `<file path="…">` blocks for `@file:` references before the raw user text.
 */
export async function expandAtFileMentionsInPlainText(text: string, workspaceRoot: string): Promise<string> {
  if (!text.includes('@file:')) return text;
  const tokens = collectFileTokens(text);
  if (tokens.length === 0) return text;

  const seen = new Set<string>();
  const blocks: string[] = [];

  for (const t of tokens) {
    if (seen.has(t.value)) continue;
    seen.add(t.value);
    const body = await workspacePathSnippet(t.value, workspaceRoot);
    blocks.push(`<file path="${escapeXmlAttr(t.value)}">\n${body}\n</file>`);
  }

  if (blocks.length === 0) return text;
  return `${blocks.join('\n\n')}\n\n${text}`;
}
