import { memo, useMemo } from 'react';
import type { UserTurnDocument } from '@xopcai/gateway-contract';
import { AppWindow, Database, FileText, Folder, MessagesSquare, NotebookPen } from 'lucide-react';

import { useSkillLabel } from '@/features/chat/palette/use-skill-label';

import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import {
  parseMessageSegments,
  type MessageSegment,
} from '@/features/chat/messages/user-message-segments.parse';
import type { MessageContextRef } from '@/features/chat/messages/messages.types';
import { cn } from '@/lib/cn';

type RenderableSegment = MessageSegment | { kind: 'context_ref'; refId: string; ref?: MessageContextRef };

function segmentSignature(p: RenderableSegment): string {
  if (p.kind === 'text') return `t:${p.text}`;
  if (p.kind === 'skill') return `s:${p.name}`;
  if (p.kind === 'context_ref') return `r:${p.refId}`;
  return `c:${p.name}`;
}

function contextRefSpacing(parts: RenderableSegment[], index: number): string {
  const previous = parts[index - 1];
  const beforePrevious = parts[index - 2];
  const next = parts[index + 1];
  const previousIsSharedWhitespace = previous?.kind === 'text'
    && previous.text.trim() === ''
    && beforePrevious !== undefined
    && beforePrevious.kind !== 'text';
  return cn(
    previous?.kind === 'text' && /\s$/u.test(previous.text) && !previousIsSharedWhitespace && 'ms-1',
    next?.kind === 'text' && /^\s/u.test(next.text) && 'me-1',
  );
}

function ContextRefIcon({ contextRef }: { contextRef?: MessageContextRef }) {
  const className = 'size-3.5 shrink-0';
  if (contextRef?.kind === 'file' && contextRef.fileKind === 'directory') {
    return <Folder className={className} aria-hidden />;
  }
  if (contextRef?.kind === 'file') return <FileText className={className} aria-hidden />;
  if (contextRef?.kind === 'session') return <MessagesSquare className={className} aria-hidden />;
  if (contextRef?.kind === 'browser_tab') return <AppWindow className={className} aria-hidden />;
  if (contextRef?.kind === 'mcp_resource') return <Database className={className} aria-hidden />;
  return <NotebookPen className={className} aria-hidden />;
}

export const UserMessageSegments = memo(function UserMessageSegments({
  text,
  conversationId,
  document,
  contextRefs,
}: {
  text: string;
  conversationId?: string | null;
  document?: UserTurnDocument;
  contextRefs?: MessageContextRef[];
}) {
  const parts = useMemo<RenderableSegment[]>(() => {
    if (!document) return parseMessageSegments(text);
    const refs = new Map(contextRefs?.flatMap(ref => ref.refId ? [[ref.refId, ref] as const] : []) ?? []);
    return document.parts.flatMap((part): RenderableSegment[] => part.type === 'text'
      ? parseMessageSegments(part.text)
      : [{ kind: 'context_ref', refId: part.refId, ref: refs.get(part.refId) }]);
  }, [contextRefs, document, text]);
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
  const skillLabel = useSkillLabel(undefined, conversationId, parts.some((p) => p.kind === 'skill'));
  const hasPill = parts.some((p) => p.kind !== 'text');

  if (!hasPill) {
    return (
      <div className="markdown-content min-w-0">
        <MarkdownView content={text} compact breaks />
      </div>
    );
  }

  return (
    <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-0 gap-y-1 [text-align:inherit]">
      {partsWithKeys.map(({ part: p, key }, index) =>
        p.kind === 'skill' ? (
          <span key={key} className="chat-skill-pill max-w-full shrink-0" data-skill={p.name} title={`/${p.name}`}>
            /{skillLabel(p.name)}
          </span>
        ) : p.kind === 'command' ? (
          <span
            key={key}
            className="chat-command-pill max-w-full shrink-0"
            data-slash-command={p.name}
          >
            /{p.name}
          </span>
        ) : p.kind === 'context_ref' ? (
          <span
            key={key}
            className={cn(
              'chat-context-ref-pill chat-context-ref-pill-message max-w-full shrink-0',
              contextRefSpacing(parts, index),
            )}
            data-context-ref-id={p.refId}
            data-ref-kind={p.ref?.kind ?? ''}
            data-file-kind={p.ref?.fileKind ?? ''}
            title={p.ref?.title}
            aria-label={p.ref?.title ?? 'reference'}
          >
            <ContextRefIcon contextRef={p.ref} />
            <span className="min-w-0 truncate">{p.ref?.title ?? 'reference'}</span>
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
