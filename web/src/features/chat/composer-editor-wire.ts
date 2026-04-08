/** Wire format: `/skill:name` for API. DOM shows pills with visible `/name` only. */

import {
  SKILL_WIRE_TRAILING_EOW_WS_RE,
  SKILL_WIRE_TRAILING_PLAIN_RE,
  skillWireTokenRe,
} from '@/features/chat/skill-wire-pattern';

const ZWSP = '\u200b';
const CARET_PROBE = '\u2060'; // word joiner — not used in skill names / user text

function isSkillPill(el: HTMLElement): boolean {
  return Boolean(el.dataset.skill);
}

function serializeWalk(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push((node.textContent ?? '').replaceAll(ZWSP, ''));
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    if (isSkillPill(el)) {
      const name = el.dataset.skill ?? '';
      if (name) out.push(`/skill:${name}`);
    } else if (el.tagName === 'BR') {
      out.push('\n');
    } else {
      // Nested wrappers (paste / browser quirks) — flatten to wire without extra newlines here.
      el.childNodes.forEach((c) => serializeWalk(c, out));
    }
  }
}

export function serializeEditorToWire(root: HTMLElement): string {
  const parts: string[] = [];
  root.childNodes.forEach((c) => serializeWalk(c, parts));
  return parts.join('').replaceAll(CARET_PROBE, '');
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
    // Collapsed range at container end / next to uneditable nodes often throws — treat as caret at EOD.
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

/**
 * When the caret is inside or at the end of a `/skill:name` token (wire coordinates),
 * remove the whole token on Backspace (contenteditable=false pills are not deleted natively).
 */
export function removeSkillTokenAtOrBeforeCaret(wire: string, caret: number): { wire: string; caret: number } | null {
  const re = skillWireTokenRe();
  let m: RegExpExecArray | null;
  while ((m = re.exec(wire)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (caret > start && caret <= end) {
      const newWire = wire.slice(0, start) + wire.slice(end);
      return { wire: newWire, caret: start };
    }
  }
  return null;
}

/**
 * If the text before the caret ends with a full `/skill:name`, remove it (handles caret one past token end).
 * When the caret is at end-of-wire, also treats ASCII / common whitespace after the token as part of the
 * removable suffix so a palette-inserted trailing space does not require an extra Backspace before the pill
 * handler runs (see {@link appendSkillPill} ZWSP).
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

  // Caret at EOW only: remove last `/skill:name` plus any trailing whitespace (not `\n` — new paragraph is real content).
  if (caret === wire.length) {
    m = head.match(SKILL_WIRE_TRAILING_EOW_WS_RE);
    if (m?.[1]) {
      const full = m[0];
      const start = head.length - full.length;
      return { wire: wire.slice(0, start) + wire.slice(caret), caret: start };
    }
  }

  return null;
}

/**
 * Handle Backspace for skill pills + ZWSP boundaries. Returns true if the event was handled (caller should preventDefault).
 */
export function handleComposerBackspace(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
    return false;
  }

  const range = sel.getRangeAt(0);
  const wire = serializeEditorToWire(root);
  let caret = getWireCaretOffset(root);

  // Selection collapsed at end of editor but probe failed → was 0; use EOW.
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

  const re = skillWireTokenRe();
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(w)) !== null) {
    const chunk = w.slice(last, m.index);
    if (chunk) root.appendChild(document.createTextNode(chunk));
    appendSkillPill(root, m[1] ?? '');
    last = m.index + m[0].length;
  }
  const rest = w.slice(last);
  if (rest) root.appendChild(document.createTextNode(rest));

  if (caretWireOffset === undefined) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n.textContent ?? '';
    const i = t.indexOf(CARET_PROBE);
    if (i >= 0) {
      const tn = n as Text;
      tn.textContent = t.slice(0, i) + t.slice(i + CARET_PROBE.length);
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(tn, i);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
      return;
    }
  }
}
