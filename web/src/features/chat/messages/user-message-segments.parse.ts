import { fileWireTokenRe, formatFilePathForWire, pathFromFileWireMatch } from '@/features/chat/palette/file-wire-pattern';
import { collectSlashCommandWireRanges } from '@/features/chat/palette/slash-command-wire';
import { skillWireTokenRe } from '@/features/chat/palette/skill-wire-pattern';

export type MessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'skill'; name: string }
  | { kind: 'file'; path: string }
  | { kind: 'command'; name: string };

export type SkillWireSegment = { kind: 'text'; text: string } | { kind: 'skill'; name: string };

/** Parse `/skill:`, `@file:`, and registered `/slashCommand` wire tokens. */
export function parseMessageSegments(text: string): MessageSegment[] {
  type Hit = { start: number; end: number; seg: MessageSegment };
  const hits: Hit[] = [];
  const add = (re: RegExp, map: (m: RegExpExecArray) => MessageSegment) => {
    const r = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = r.exec(text)) !== null) {
      hits.push({ start: m.index, end: m.index + m[0].length, seg: map(m) });
    }
  };
  add(skillWireTokenRe(), (m) => ({ kind: 'skill', name: m[1] ?? '' }));
  add(fileWireTokenRe(), (m) => ({ kind: 'file', path: pathFromFileWireMatch(m) }));
  for (const r of collectSlashCommandWireRanges(text)) {
    hits.push({
      start: r.start,
      end: r.end,
      seg: { kind: 'command', name: text.slice(r.start + 1, r.end) },
    });
  }

  hits.sort((a, b) => (a.start !== b.start ? a.start - b.start : b.end - a.end));
  const out: MessageSegment[] = [];
  let last = 0;
  for (const h of hits) {
    if (h.start < last) continue;
    if (h.start > last) {
      out.push({ kind: 'text', text: text.slice(last, h.start) });
    }
    out.push(h.seg);
    last = h.end;
  }
  if (last < text.length) {
    out.push({ kind: 'text', text: text.slice(last) });
  }
  if (out.length === 0) {
    out.push({ kind: 'text', text });
  }
  return out;
}

/** Maps non-skill segments to plain text for legacy callers. */
export function parseSkillWireSegments(text: string): SkillWireSegment[] {
  const merged: SkillWireSegment[] = [];
  for (const p of parseMessageSegments(text)) {
    if (p.kind === 'skill') {
      merged.push(p);
    } else if (p.kind === 'text') {
      const prev = merged[merged.length - 1];
      if (prev?.kind === 'text') prev.text += p.text;
      else merged.push(p);
    } else if (p.kind === 'command') {
      const chunk = `/${p.name}`;
      const prev = merged[merged.length - 1];
      if (prev?.kind === 'text') prev.text += chunk;
      else merged.push({ kind: 'text', text: chunk });
    } else {
      const chunk = `@file:${formatFilePathForWire(p.path)}`;
      const prev = merged[merged.length - 1];
      if (prev?.kind === 'text') prev.text += chunk;
      else merged.push({ kind: 'text', text: chunk });
    }
  }
  return merged.length > 0 ? merged : [{ kind: 'text', text }];
}
