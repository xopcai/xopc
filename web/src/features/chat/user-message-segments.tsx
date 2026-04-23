import { memo, useMemo } from 'react';

import { fileWireTokenRe } from '@/features/chat/file-wire-pattern';
import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import { skillWireTokenRe } from '@/features/chat/skill-wire-pattern';

export type MessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'skill'; name: string }
  | { kind: 'file'; path: string };

export type SkillWireSegment = { kind: 'text'; text: string } | { kind: 'skill'; name: string };

function fileBubbleLabel(path: string): string {
  const trimmed = path.replace(/\/$/, '');
  const base = trimmed.split('/').pop() ?? trimmed;
  return `@${base}`;
}

/** Parse `/skill:` and `@file:` wire tokens in user-visible message text. */
export function parseMessageSegments(text: string): MessageSegment[] {
  type Hit = { start: number; end: number; seg: MessageSegment };
  const hits: Hit[] = [];
  const reSkill = skillWireTokenRe();
  let m: RegExpExecArray | null;
  while ((m = reSkill.exec(text)) !== null) {
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      seg: { kind: 'skill', name: m[1] ?? '' },
    });
  }
  const reFile = fileWireTokenRe();
  while ((m = reFile.exec(text)) !== null) {
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      seg: { kind: 'file', path: m[1] ?? '' },
    });
  }
  hits.sort((a, b) => a.start - b.start);

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

/** Prefer {@link parseMessageSegments}; maps `file` segments to plain `@file:` text for legacy callers. */
export function parseSkillWireSegments(text: string): SkillWireSegment[] {
  const merged: SkillWireSegment[] = [];
  for (const p of parseMessageSegments(text)) {
    if (p.kind === 'file') {
      const chunk = `@file:${p.path}`;
      const prev = merged[merged.length - 1];
      if (prev?.kind === 'text') prev.text += chunk;
      else merged.push({ kind: 'text', text: chunk });
    } else {
      const prev = merged[merged.length - 1];
      if (p.kind === 'text' && prev?.kind === 'text') prev.text += p.text;
      else merged.push(p);
    }
  }
  return merged.length > 0 ? merged : [{ kind: 'text', text }];
}

/**
 * User bubble: render `/skill:name` and `@file:path` as inline pills; otherwise render Markdown as usual.
 */
export const UserMessageSegments = memo(function UserMessageSegments({ text }: { text: string }) {
  const parts = useMemo(() => parseMessageSegments(text), [text]);
  const hasPill = parts.some((p) => p.kind === 'skill' || p.kind === 'file');

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
        ) : p.kind === 'file' ? (
          <span key={`file-${i}-${p.path}`} className="chat-file-pill max-w-full shrink-0" data-file={p.path}>
            {fileBubbleLabel(p.path)}
          </span>
        ) : p.text ? (
          <span key={`txt-${i}`} className="min-w-0 whitespace-pre-wrap break-words text-fg">
            {p.text}
          </span>
        ) : null,
      )}
    </span>
  );
});
