import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  resolveWorkspaceSafePath,
  toWorkspaceRelativePosix,
} from '../../gateway/workspace-editor-path.js';
import { runRipgrepSymbolHits } from '../../gateway/workspace-ripgrep.js';

const FILE_RE = /@file:([a-zA-Z0-9_./-]+)/g;
const DOC_RE = /@doc:([a-zA-Z0-9_./-]+)/g;
const URL_RE = /@url:(https?:\/\/[^\s]+)/g;
const SYM_RE = /@symbol:([a-zA-Z0-9_][a-zA-Z0-9_.]*)/g;

const MAX_PATH_BYTES = 50_000;
const MAX_DIR_ENTRIES = 120;
const MAX_URL_BYTES = 32_000;
const SYMBOL_CONTEXT_LINES = 72;

type TokKind = 'file' | 'doc' | 'url' | 'symbol';

interface TokenHit {
  start: number;
  end: number;
  kind: TokKind;
  value: string;
}

function collectContextTokens(text: string): TokenHit[] {
  const out: TokenHit[] = [];
  const scan = (kind: TokKind, re: RegExp) => {
    const r = new RegExp(re.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = r.exec(text)) !== null) {
      const v = m[1]?.trim() ?? '';
      if (v) out.push({ start: m.index, end: m.index + m[0].length, kind, value: v });
    }
  };
  scan('file', FILE_RE);
  scan('doc', DOC_RE);
  scan('url', URL_RE);
  scan('symbol', SYM_RE);
  out.sort((a, b) => a.start - b.start);
  const pruned: TokenHit[] = [];
  let cover = -1;
  for (const t of out) {
    if (t.start < cover) continue;
    pruned.push(t);
    cover = t.end;
  }
  return pruned;
}

async function workspacePathSnippet(rel: string, workspaceRoot: string, kind: 'file' | 'doc'): Promise<string> {
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

async function fetchUrlSnippet(url: string): Promise<string> {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return '[only http(s) URLs are expanded]';
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'xopc-context-expand/1',
          Accept: 'text/plain,text/html;q=0.9,*/*;q=0.1',
        },
      });
      const buf = await res.arrayBuffer();
      const slice = buf.byteLength > MAX_URL_BYTES ? buf.slice(0, MAX_URL_BYTES) : buf;
      let text = new TextDecoder('utf-8', { fatal: false }).decode(slice);
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('text/html')) {
        text = text
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '');
        text = text.replace(/<[^>]+>/g, ' ');
        text = text.replace(/\s+/g, ' ').trim();
      }
      return text.length >= MAX_URL_BYTES ? `${text}\n[truncated]` : text;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return '[failed to fetch url]';
  }
}

async function symbolSnippet(name: string, workspaceRoot: string): Promise<string> {
  const hits = await runRipgrepSymbolHits(workspaceRoot, name, 8);
  if (hits.length === 0) {
    return `[no source hits for "${name}"]`;
  }
  const h = hits[0]!;
  const abs = join(workspaceRoot, h.filePath.replace(/^\.\//, ''));
  const rel = toWorkspaceRelativePosix(workspaceRoot, abs);
  try {
    const content = await readFile(abs, 'utf-8');
    const lines = content.split('\n');
    const idx = Math.max(0, h.lineNumber - 1);
    const half = Math.floor(SYMBOL_CONTEXT_LINES / 2);
    const from = Math.max(0, idx - half);
    const to = Math.min(lines.length, idx + half + 1);
    const body = lines.slice(from, to).join('\n');
    return `path: ${rel}\nline: ${h.lineNumber}\npreview: ${h.lineContent}\n\n--- context ---\n${body}`;
  } catch {
    return `path: ${rel}\nline: ${h.lineNumber}\npreview: ${h.lineContent}`;
  }
}

/**
 * Prepend structured blocks for `@file:`, `@doc:`, `@url:`, and `@symbol:` references before the raw user text.
 */
export async function expandAllContextMentionsInPlainText(text: string, workspaceRoot: string): Promise<string> {
  if (!text.includes('@')) return text;
  const tokens = collectContextTokens(text);
  if (tokens.length === 0) return text;

  const seen = new Set<string>();
  const blocks: string[] = [];

  for (const t of tokens) {
    const dedupeKey = `${t.kind}:${t.value}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    if (t.kind === 'file') {
      const body = await workspacePathSnippet(t.value, workspaceRoot, 'file');
      blocks.push(`<file path="${t.value}">\n${body}\n</file>`);
    } else if (t.kind === 'doc') {
      const body = await workspacePathSnippet(t.value, workspaceRoot, 'doc');
      blocks.push(`<doc path="${t.value}">\n${body}\n</doc>`);
    } else if (t.kind === 'url') {
      const body = await fetchUrlSnippet(t.value);
      blocks.push(`<url href="${t.value}">\n${body}\n</url>`);
    } else {
      const body = await symbolSnippet(t.value, workspaceRoot);
      blocks.push(`<symbol name="${t.value}">\n${body}\n</symbol>`);
    }
  }

  if (blocks.length === 0) return text;
  return `${blocks.join('\n\n')}\n\n${text}`;
}
