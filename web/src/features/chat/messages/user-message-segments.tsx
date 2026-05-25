import { memo, useMemo } from 'react';

import { fileWireTokenRe, formatFilePathForWire, pathFromFileWireMatch } from '@/features/chat/palette/file-wire-pattern';
import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import { collectSlashCommandWireRanges } from '@/features/chat/palette/slash-command-wire';
import { skillWireTokenRe } from '@/features/chat/palette/skill-wire-pattern';

export type MessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'skill'; name: string }
  | { kind: 'file'; path: string }
  | { kind: 'command'; name: string };

export type SkillWireSegment = { kind: 'text'; text: string } | { kind: 'skill'; name: string };

function fileBubbleLabel(path: string): string {
  const trimmed = path.replace(/\/$/, '');
  const base = trimmed.split('/').pop() ?? trimmed;
  return `@${base}`;
}

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

function segmentSignature(p: MessageSegment): string {
  if (p.kind === 'text') return `t:${p.text}`;
  if (p.kind === 'skill') return `s:${p.name}`;
  if (p.kind === 'file') return `f:${p.path}`;
  return `c:${p.name}`;
}

export const UserMessageSegments = memo(function UserMessageSegments({ text }: { text: string }) {
  const parts = useMemo(() => parseMessageSegments(text), [text]);
  const partsWithKeys = useMemo(() => {
    // Disambiguate identical segments (e.g. same skill referenced twice) with a running counter,
    // captured here in a closure so the JSX map can read keys without using the .map index.
    const seen = new Map<string, number>();
    return parts.map((p) => {
      const sig = segmentSignature(p);
      const occurrence = seen.get(sig) ?? 0;
      seen.set(sig, occurrence + 1);
      return { part: p, key: `${sig}#${String(occurrence)}` };
    });
  }, [parts]);
  const hasPill = parts.some((p) => p.kind !== 'text');

  if (!hasPill) {
    return (
      <div className="markdown-content min-w-0">
        <MarkdownView content={text} compact />
      </div>
    );
  }

  return (
    <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-1 [text-align:inherit]">
      {partsWithKeys.map(({ part: p, key }) =>
        p.kind === 'skill' ? (
          <span key={key} className="chat-skill-pill max-w-full shrink-0" data-skill={p.name}>
            /{p.name}
          </span>
        ) : p.kind === 'command' ? (
          <span
            key={key}
            className="chat-command-pill max-w-full shrink-0"
            data-slash-command={p.name}
          >
            /{p.name}
          </span>
        ) : p.kind === 'file' ? (
          <span key={key} className="chat-file-pill max-w-full shrink-0" data-file={p.path}>
            {fileBubbleLabel(p.path)}
          </span>
        ) : p.text ? (
          <div
            key={key}
            className="markdown-content inline-block min-w-0 max-w-full align-baseline text-fg"
          >
            <MarkdownView content={p.text} compact breaks />
          </div>
        ) : null,
      )}
    </span>
  );
});
