import { memo, useMemo } from 'react';

import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import {
  parseMessageSegments,
  type MessageSegment,
} from '@/features/chat/messages/user-message-segments.parse';

function fileBubbleLabel(path: string): string {
  const trimmed = path.replace(/\/$/, '');
  const base = trimmed.split('/').pop() ?? trimmed;
  return `@${base}`;
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
        <MarkdownView content={text} compact breaks />
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
            className="chat-user-message-segment markdown-content inline-block min-w-0 max-w-full align-baseline text-fg"
          >
            <MarkdownView content={p.text} compact breaks />
          </div>
        ) : null,
      )}
    </span>
  );
});
