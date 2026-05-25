import type { CommandEntry } from '@/features/chat/palette/command-palette.types';
import { SKILL_ID_IN_WIRE } from '@/features/chat/palette/skill-wire-pattern';

const SKILL_HEAD_AT = new RegExp(`^\\/skill:(${SKILL_ID_IN_WIRE})`);

let sortedEntries: Array<{ key: string }> = [];

/** Rebuilt when `fetchCommandsCached` resolves (and on empty / failure). */
export function refreshSlashCommandWireIndex(commands: CommandEntry[] | null | undefined): void {
  const keys = new Set<string>();
  for (const c of commands ?? []) {
    if (c?.name) keys.add(c.name);
    for (const a of c.aliases ?? []) {
      if (typeof a === 'string' && a.length > 0) keys.add(a);
    }
  }
  sortedEntries = [...keys].sort((a, b) => b.length - a.length).map((key) => ({ key }));
}

function boundaryOk(rest: string, endExclusive: number): boolean {
  if (endExclusive >= rest.length) return true;
  const ch = rest[endExclusive];
  return !/[a-zA-Z0-9_-]/.test(ch);
}

function canStartSlashCommandAt(wire: string, i: number): boolean {
  if (wire[i] !== '/') return false;
  if (i > 0 && !/\s/.test(wire[i - 1])) return false;
  return true;
}

/**
 * Match a registered `/command` token at `wire[i]` (must be after start-of-string or whitespace).
 */
export function trySlashCommandTokenAt(wire: string, i: number): { len: number; matchedKey: string } | null {
  if (!canStartSlashCommandAt(wire, i) || sortedEntries.length === 0) return null;
  const rest = wire.slice(i);
  if (rest.startsWith('/skill:')) return null;
  for (const { key } of sortedEntries) {
    const prefixed = `/${key}`;
    if (!rest.startsWith(prefixed)) continue;
    if (!boundaryOk(rest, prefixed.length)) continue;
    return { len: prefixed.length, matchedKey: key };
  }
  return null;
}

export function collectSlashCommandWireRanges(wire: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < wire.length) {
    if (wire[i] !== '/') {
      i += 1;
      continue;
    }
    const rest = wire.slice(i);
    const sk = rest.match(SKILL_HEAD_AT);
    if (sk?.[0]) {
      i += sk[0].length;
      continue;
    }
    const hit = trySlashCommandTokenAt(wire, i);
    if (hit) {
      ranges.push({ start: i, end: i + hit.len });
      i += hit.len;
    } else {
      i += 1;
    }
  }
  return ranges;
}

export function wireEndsWithCompleteSlashCommandToken(wire: string): boolean {
  for (let slash = wire.length - 1; slash >= 0; slash -= 1) {
    if (wire[slash] !== '/') continue;
    if (wire.startsWith('/skill:', slash)) continue;
    const hit = trySlashCommandTokenAt(wire, slash);
    if (hit && slash + hit.len === wire.length) return true;
  }
  return false;
}

export function partStartsWithCompleteSlashCommand(part: string): boolean {
  if (!part.startsWith('/') || sortedEntries.length === 0) return false;
  if (part.startsWith('/skill:')) return false;
  const hit = trySlashCommandTokenAt(part, 0);
  if (!hit) return false;
  return part.length === hit.len || !/[a-zA-Z0-9_-]/.test(part[hit.len]);
}

function escapeReLit(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `head` ends with `/${key}` (caret flush after token). */
export function slashCommandPlainSuffixAtEnd(head: string): { tokenStart: number } | null {
  for (const { key } of sortedEntries) {
    const tok = `/${key}`;
    if (!head.endsWith(tok)) continue;
    const tokenStart = head.length - tok.length;
    if (trySlashCommandTokenAt(head, tokenStart)) return { tokenStart };
  }
  return null;
}

/** `head` ends with `/${key}` plus optional spaces (caret at EOW). */
export function slashCommandEowSuffixAtEnd(head: string): { tokenStart: number } | null {
  for (const { key } of sortedEntries) {
    const tok = `/${key}`;
    const m = head.match(new RegExp(`(${escapeReLit(tok)})([ \\t\\f\\v]*)$`));
    if (!m) continue;
    const tokenStart = head.length - m[0].length;
    if (trySlashCommandTokenAt(head, tokenStart)) return { tokenStart };
  }
  return null;
}
