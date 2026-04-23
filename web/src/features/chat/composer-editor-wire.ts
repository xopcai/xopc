/** Wire format: `/skill:name` and `@file:path` for API. DOM shows pills. */

import {
  FILE_PATH_IN_WIRE,
  FILE_WIRE_TRAILING_EOW_WS_RE,
  FILE_WIRE_TRAILING_PLAIN_RE,
  fileWireTokenRe,
} from '@/features/chat/file-wire-pattern';
import {
  SKILL_ID_IN_WIRE,
  SKILL_WIRE_TRAILING_EOW_WS_RE,
  SKILL_WIRE_TRAILING_PLAIN_RE,
  skillWireTokenRe,
} from '@/features/chat/skill-wire-pattern';

const ZWSP = '\u200b';
const CARET_PROBE = '\u2060'; // word joiner — not used in skill names / user text

const SKILL_HEAD_RE = new RegExp(`^\\/skill:(${SKILL_ID_IN_WIRE})`);
const FILE_HEAD_RE = new RegExp(`^@file:(${FILE_PATH_IN_WIRE})`);

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
      if (filePath) out.push(`@file:${filePath}`);
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
  return parts.join('').replaceAll(CARET_PROBE, '');
}

/** Collapsed selection at the start of the composer (empty or first text node). */
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

/**
 * Clear DOM debris that serializes to an empty wire (e.g. ZWSP-only text, empty wrappers) so the
 * `::before` placeholder (`composer-input-empty`) does not show on top of invisible nodes.
 * Whitespace and `<br>` are kept — they produce a non-empty wire and hide the placeholder via class logic.
 */
export function normalizeOrphanComposerDom(root: HTMLElement): string {
  const wire = serializeEditorToWire(root);
  if (wire.length > 0 || root.childNodes.length === 0) {
    return wire;
  }
  applyWireToEditor(root, '');
  placeCaretAtStartOfComposer(root);
  return '';
}

/** All `/skill:name` tokens in wire (for palette dedup). */
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

/** Caret offset in wire (same indices as {@link serializeEditorToWire}). */
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
  const raw = parts.join('');
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
  const reS = skillWireTokenRe();
  let m: RegExpExecArray | null;
  while ((m = reS.exec(wire)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  const reF = fileWireTokenRe();
  while ((m = reF.exec(wire)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}

/**
 * When the caret is inside or at the end of a `/skill:name` or `@file:path` token (wire coordinates),
 * remove the whole token on Backspace (contenteditable=false pills are not deleted natively).
 */
export function removeSkillTokenAtOrBeforeCaret(wire: string, caret: number): { wire: string; caret: number } | null {
  for (const { start, end } of collectWireTokenRanges(wire)) {
    if (caret > start && caret <= end) {
      return { wire: wire.slice(0, start) + wire.slice(end), caret: start };
    }
  }
  return null;
}

/**
 * If the text before the caret ends with a full `/skill:name` or `@file:path`, remove it (caret one past token end).
 */
export function removeTrailingSkillTokenBeforeCaret(wire: string, caret: number): { wire: string; caret: number } | null {
  if (caret <= 0) {
    return null;
  }
  const head = wire.slice(0, caret);

  let m = head.match(SKILL_WIRE_TRAILING_PLAIN_RE);
  if (m?.[1]) {
    const tok = m[1];
    const start = head.length - tok.length;
    return { wire: wire.slice(0, start) + wire.slice(caret), caret: start };
  }

  m = head.match(FILE_WIRE_TRAILING_PLAIN_RE);
  if (m?.[1]) {
    const tok = m[1];
    const start = head.length - tok.length;
    return { wire: wire.slice(0, start) + wire.slice(caret), caret: start };
  }

  if (caret === wire.length) {
    m = head.match(SKILL_WIRE_TRAILING_EOW_WS_RE);
    if (m?.[1]) {
      const full = m[0];
      const start = head.length - full.length;
      return { wire: wire.slice(0, start) + wire.slice(caret), caret: start };
    }
    m = head.match(FILE_WIRE_TRAILING_EOW_WS_RE);
    if (m?.[1]) {
      const full = m[0];
      const start = head.length - full.length;
      return { wire: wire.slice(0, start) + wire.slice(caret), caret: start };
    }
  }

  return null;
}

/**
 * Handle Backspace for skill / file pills + ZWSP boundaries. Returns true if the event was handled (caller should preventDefault).
 */
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

/** Build editor DOM from wire; optional caret position in wire coordinates. */
export function applyWireToEditor(root: HTMLElement, wire: string, caretWireOffset?: number): void {
  root.replaceChildren();

  let w = wire;
  if (caretWireOffset !== undefined) {
    const o = Math.max(0, Math.min(caretWireOffset, wire.length));
    w = wire.slice(0, o) + CARET_PROBE + wire.slice(o);
  }

  let i = 0;
  while (i < w.length) {
    const rest = w.slice(i);
    const skillM = rest.match(SKILL_HEAD_RE);
    const fileM = rest.match(FILE_HEAD_RE);
    if (skillM?.[0] && (!fileM?.[0] || skillM[0].length <= fileM[0].length)) {
      appendSkillPill(root, skillM[1] ?? '');
      i += skillM[0].length;
      continue;
    }
    if (fileM?.[0]) {
      appendFilePill(root, fileM[1] ?? '');
      i += fileM[0].length;
      continue;
    }
    let j = i + 1;
    while (j < w.length) {
      const tail = w.slice(j);
      if (tail.match(/^(?:\/skill:|@file:)/)) break;
      j++;
    }
    const chunk = w.slice(i, j);
    if (chunk) root.appendChild(document.createTextNode(chunk));
    i = j;
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
