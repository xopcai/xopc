/** Wire format: `/skill:name`, `@file:path`. DOM shows pills. */

import {
  FILE_COMPOSER_HEAD_RE,
  FILE_WIRE_TRAILING_EOW_WS_RE,
  FILE_WIRE_TRAILING_PLAIN_RE,
  fileWireTokenRe,
  formatFilePathForWire,
  pathFromFileWireMatch,
  wireTextEndsWithCompleteFileToken,
} from '@/features/chat/file-wire-pattern';
import {
  SKILL_ID_IN_WIRE,
  SKILL_WIRE_TRAILING_EOW_WS_RE,
  SKILL_WIRE_TRAILING_PLAIN_RE,
  skillWireTokenRe,
} from '@/features/chat/skill-wire-pattern';

const ZWSP = '\u200b';
const CARET_PROBE = '\u2060';

const SKILL_HEAD_RE = new RegExp(`^\\/skill:(${SKILL_ID_IN_WIRE})`);

function isSkillPill(el: HTMLElement): boolean {
  return Boolean(el.dataset.skill);
}

function isFilePill(el: HTMLElement): boolean {
  return Boolean(el.dataset.file);
}

function filePillLabel(relativePath: string): string {
  const trimmed = relativePath.replace(/\/$/, '');
  const base = trimmed.split('/').pop() ?? trimmed;
  return `@${base}`;
}

/**
 * ZWSP between pill and following text is stripped per-node; without a separator, wire becomes
 * `@file:path析` and parses as one path. Insert a space when gluing would merge a wire token with
 * adjacent non-whitespace (pill → text, text → pill, pill → pill).
 */
function joinComposerWireParts(parts: string[]): string {
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    if (out.length > 0) {
      const last = out[out.length - 1]!;
      const first = part[0]!;
      if (!/\s/.test(last) && !/\s/.test(first)) {
        const endsWithWire = wireTextEndsWithCompleteFileToken(out) || /\/skill:\S+$/.test(out);
        const startsWithWire = part.startsWith('@file:') || part.startsWith('/skill:');
        if (endsWithWire || startsWithWire) {
          out += ' ';
        }
      }
    }
    out += part;
  }
  return out;
}

function serializeWalk(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push((node.textContent ?? '').replaceAll(ZWSP, ''));
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    if (isSkillPill(el)) {
      const name = el.dataset.skill ?? '';
      if (name) out.push(`/skill:${name}`);
    } else if (isFilePill(el)) {
      const filePath = el.dataset.file ?? '';
      if (filePath) out.push(`@file:${formatFilePathForWire(filePath)}`);
    } else if (el.tagName === 'BR') {
      out.push('\n');
    } else {
      el.childNodes.forEach((c) => serializeWalk(c, out));
    }
  }
}

export function serializeEditorToWire(root: HTMLElement): string {
  const parts: string[] = [];
  root.childNodes.forEach((c) => serializeWalk(c, parts));
  return joinComposerWireParts(parts).replaceAll(CARET_PROBE, '');
}

export function placeCaretAtStartOfComposer(root: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const first = root.firstChild;
  if (!first) {
    range.setStart(root, 0);
    range.collapse(true);
  } else if (first.nodeType === Node.TEXT_NODE) {
    range.setStart(first, 0);
    range.collapse(true);
  } else {
    range.setStart(root, 0);
    range.collapse(true);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

export function normalizeOrphanComposerDom(root: HTMLElement): string {
  const wire = serializeEditorToWire(root);
  if (wire.length > 0 || root.childNodes.length === 0) {
    return wire;
  }
  applyWireToEditor(root, '');
  placeCaretAtStartOfComposer(root);
  return '';
}

export function listSkillNamesInWire(wire: string): Set<string> {
  const out = new Set<string>();
  const re = skillWireTokenRe();
  let m: RegExpExecArray | null;
  while ((m = re.exec(wire)) !== null) {
    const name = m[1];
    if (name) out.add(name);
  }
  return out;
}

export function getWireCaretOffset(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return serializeEditorToWire(root).length;

  const range = sel.getRangeAt(0);
  const marker = document.createTextNode(CARET_PROBE);
  try {
    range.insertNode(marker);
  } catch {
    return serializeEditorToWire(root).length;
  }

  const parts: string[] = [];
  root.childNodes.forEach((c) => serializeWalk(c, parts));
  const raw = joinComposerWireParts(parts);
  marker.parentNode?.removeChild(marker);

  const idx = raw.indexOf(CARET_PROBE);
  return idx >= 0 ? idx : raw.replaceAll(CARET_PROBE, '').length;
}

function appendSkillPill(root: HTMLElement, name: string): void {
  const span = document.createElement('span');
  span.contentEditable = 'false';
  span.dataset.skill = name;
  span.className = 'chat-skill-pill';
  span.textContent = `/${name}`;
  root.appendChild(span);
  root.appendChild(document.createTextNode(ZWSP));
}

function appendFilePill(root: HTMLElement, relativePath: string): void {
  const span = document.createElement('span');
  span.contentEditable = 'false';
  span.dataset.file = relativePath;
  span.className = 'chat-file-pill';
  span.textContent = filePillLabel(relativePath);
  root.appendChild(span);
  root.appendChild(document.createTextNode(ZWSP));
}

function collectWireTokenRanges(wire: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const pushAll = (re: RegExp) => {
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(wire)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length });
    }
  };
  pushAll(skillWireTokenRe());
  pushAll(fileWireTokenRe());
  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}

export function removeSkillTokenAtOrBeforeCaret(wire: string, caret: number): { wire: string; caret: number } | null {
  for (const { start, end } of collectWireTokenRanges(wire)) {
    if (caret > start && caret <= end) {
      return { wire: wire.slice(0, start) + wire.slice(end), caret: start };
    }
  }
  return null;
}

export function removeTrailingSkillTokenBeforeCaret(wire: string, caret: number): { wire: string; caret: number } | null {
  if (caret <= 0) {
    return null;
  }
  const head = wire.slice(0, caret);

  const tryPlain = (re: RegExp) => {
    const m = head.match(re);
    if (m?.[1]) {
      const tok = m[1];
      const start = head.length - tok.length;
      return { wire: wire.slice(0, start) + wire.slice(caret), caret: start };
    }
    return null;
  };

  const plainMatchers = [SKILL_WIRE_TRAILING_PLAIN_RE, FILE_WIRE_TRAILING_PLAIN_RE];
  for (const re of plainMatchers) {
    const hit = tryPlain(re);
    if (hit) return hit;
  }

  if (caret === wire.length) {
    const eowMatchers = [SKILL_WIRE_TRAILING_EOW_WS_RE, FILE_WIRE_TRAILING_EOW_WS_RE];
    for (const re of eowMatchers) {
      const m = head.match(re);
      if (m?.[1]) {
        const full = m[0];
        const start = head.length - full.length;
        return { wire: wire.slice(0, start) + wire.slice(caret), caret: start };
      }
    }
  }

  return null;
}

export function handleComposerBackspace(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
    return false;
  }

  const range = sel.getRangeAt(0);
  const wire = serializeEditorToWire(root);
  let caret = getWireCaretOffset(root);

  if (
    caret === 0 &&
    wire.length > 0 &&
    range.startContainer === root &&
    range.startOffset === root.childNodes.length
  ) {
    caret = wire.length;
  }

  let cut = removeSkillTokenAtOrBeforeCaret(wire, caret);
  if (!cut) {
    cut = removeTrailingSkillTokenBeforeCaret(wire, caret);
  }
  if (!cut) {
    return false;
  }
  applyWireToEditor(root, cut.wire, cut.caret);
  root.dispatchEvent(new InputEvent('input', { bubbles: true }));
  return true;
}

const TOKEN_START_RE = /^(?:\/skill:|@file:)/;

function consumeNextToken(root: HTMLElement, w: string, i: number): number {
  const rest = w.slice(i);
  type Cand = { len: number; apply: () => void };
  const cands: Cand[] = [];

  const skillM = rest.match(SKILL_HEAD_RE);
  if (skillM?.[0]) {
    cands.push({
      len: skillM[0].length,
      apply: () => appendSkillPill(root, skillM[1] ?? ''),
    });
  }
  const fileM = rest.match(FILE_COMPOSER_HEAD_RE);
  if (fileM?.[0]) {
    cands.push({
      len: fileM[0].length,
      apply: () => appendFilePill(root, pathFromFileWireMatch(fileM)),
    });
  }

  if (cands.length === 0) {
    let j = i + 1;
    while (j < w.length) {
      const tail = w.slice(j);
      if (TOKEN_START_RE.test(tail)) break;
      j++;
    }
    const chunk = w.slice(i, j);
    if (chunk) root.appendChild(document.createTextNode(chunk));
    return j;
  }

  cands.sort((a, b) => b.len - a.len);
  cands[0].apply();
  return i + cands[0].len;
}

export function applyWireToEditor(root: HTMLElement, wire: string, caretWireOffset?: number): void {
  root.replaceChildren();

  let w = wire;
  if (caretWireOffset !== undefined) {
    const o = Math.max(0, Math.min(caretWireOffset, wire.length));
    w = wire.slice(0, o) + CARET_PROBE + wire.slice(o);
  }

  let i = 0;
  while (i < w.length) {
    i = consumeNextToken(root, w, i);
  }

  if (caretWireOffset === undefined) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n.textContent ?? '';
    const idx = t.indexOf(CARET_PROBE);
    if (idx >= 0) {
      const tn = n as Text;
      tn.textContent = t.slice(0, idx) + t.slice(idx + CARET_PROBE.length);
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(tn, idx);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
      return;
    }
  }
}
