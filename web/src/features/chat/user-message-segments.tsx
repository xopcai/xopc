import { memo, useMemo } from 'react';

import { fileWireTokenRe, formatFilePathForWire, pathFromFileWireMatch } from '@/features/chat/file-wire-pattern';
import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import { collectSlashCommandWireRanges } from '@/features/chat/slash-command-wire';
import { skillWireTokenRe } from '@/features/chat/skill-wire-pattern';

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

export const UserMessageSegments = memo(function UserMessageSegments({ text }: { text: string }) {
  const parts = useMemo(() => parseMessageSegments(text), [text]);
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
      {parts.map((p, i) =>
        p.kind === 'skill' ? (
          <span key={`skill-${i}-${p.name}`} className="chat-skill-pill max-w-full shrink-0" data-skill={p.name}>
            /{p.name}
          </span>
        ) : p.kind === 'command' ? (
          <span
            key={`cmd-${i}-${p.name}`}
            className="chat-command-pill max-w-full shrink-0"
            data-slash-command={p.name}
          >
            /{p.name}
          </span>
        ) : p.kind === 'file' ? (
          <span key={`file-${i}-${p.path}`} className="chat-file-pill max-w-full shrink-0" data-file={p.path}>
            {fileBubbleLabel(p.path)}
          </span>
        ) : p.text ? (
          <div
            key={`txt-${i}`}
            className="markdown-content inline-block min-w-0 max-w-full align-baseline text-fg"
          >
            <MarkdownView content={p.text} compact breaks />
          </div>
        ) : null,
      )}
    </span>
  );
});
