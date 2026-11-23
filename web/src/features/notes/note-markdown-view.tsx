import { useCallback, useLayoutEffect, useRef } from 'react';

import { isLikelyAudioAttachment } from '@/components/block-editor/audio-block';
import { splitImageAltAndWidth } from '@/components/block-editor/extensions/resizable-image';
import { MarkdownView, type MarkdownViewProps } from '@/components/markdown/markdown-view';
import type { MarkdownChartBlock } from '@/components/markdown/parse-markdown';
import { ChatChartBlock } from '@/features/chat/rendering/markdown/chat-chart-block';
import { InlinePreviewSchedulerProvider } from '@/features/chat/product-delivery/inline-preview-scheduler';

import { parseNoteAttachmentTarget } from './attachment-ref';
import { acquireNoteMediaObjectUrl, releaseNoteMediaObjectUrl } from './note-media-blob';
import type { NoteAttachment } from './notes-api';

/** Rewrite canonical refs to API paths for marked HTML generation, then hydrate via blob fetch. */
function noteMarkdownForRender(content: string): string {
  return content.replace(
    /xopc-attachment:\/\/notes\/([^/]+)\/([^)\s]+)/gi,
    '/api/notes/$1/media/$2',
  );
}

function hydrateNoteMedia(root: HTMLElement, noteId?: string, attachments?: NoteAttachment[]): () => void {
  const cleanups: Array<() => void> = [];

  root.querySelectorAll<HTMLImageElement>('.markdown-body img').forEach((img) => {
    const rawAlt = img.getAttribute('alt');
    if (rawAlt) {
      const { alt, width } = splitImageAltAndWidth(rawAlt);
      if (width) {
        img.alt = alt;
        img.style.width = `${width}px`;
        img.style.maxWidth = '100%';
      }
    }

    const rawSrc = img.getAttribute('src') ?? '';
    const parsed = parseNoteAttachmentTarget(rawSrc, noteId);
    if (!parsed) return;

    let cancelled = false;
    void acquireNoteMediaObjectUrl(parsed.noteId, parsed.attachmentId)
      .then((url) => {
        if (!cancelled) img.src = url;
      })
      .catch(() => {
        img.classList.add('note-media-load-failed');
      });

    cleanups.push(() => {
      cancelled = true;
      releaseNoteMediaObjectUrl(parsed.noteId, parsed.attachmentId);
    });
  });

  root.querySelectorAll<HTMLAnchorElement>('.markdown-body a').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    const parsed = parseNoteAttachmentTarget(href, noteId);
    if (!parsed) return;

    const matched = attachments?.find((item) => item.id === parsed.attachmentId);
    const label = anchor.textContent ?? '';
    if (!isLikelyAudioAttachment(matched, label)) {
      const fileName = matched?.fileName || label.trim() || parsed.attachmentId;
      anchor.classList.add(
        'inline-flex',
        'items-center',
        'gap-1.5',
        'rounded-lg',
        'border',
        'border-edge',
        'bg-surface-panel',
        'px-3',
        'py-1.5',
        'text-sm',
        'no-underline',
        'hover:bg-surface-hover',
      );
      const onClick = (event: MouseEvent) => {
        event.preventDefault();
        void acquireNoteMediaObjectUrl(parsed.noteId, parsed.attachmentId).then((objectUrl) => {
          const dl = document.createElement('a');
          dl.href = objectUrl;
          dl.download = fileName;
          document.body.appendChild(dl);
          dl.click();
          dl.remove();
          window.setTimeout(() => releaseNoteMediaObjectUrl(parsed.noteId, parsed.attachmentId), 5_000);
        });
      };
      anchor.addEventListener('click', onClick);
      cleanups.push(() => anchor.removeEventListener('click', onClick));
      return;
    }

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.className = 'note-media-audio mt-2 w-full max-w-md';
    anchor.replaceWith(audio);

    let cancelled = false;
    void acquireNoteMediaObjectUrl(parsed.noteId, parsed.attachmentId)
      .then((url) => {
        if (!cancelled) audio.src = url;
      })
      .catch(() => {
        audio.remove();
      });

    cleanups.push(() => {
      cancelled = true;
      releaseNoteMediaObjectUrl(parsed.noteId, parsed.attachmentId);
    });
  });

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

export type NoteMarkdownViewProps = MarkdownViewProps & {
  noteId?: string;
  attachments?: NoteAttachment[];
};

export function NoteMarkdownView({ content, noteId, attachments, ...rest }: NoteMarkdownViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const renderChart = useCallback((block: MarkdownChartBlock) => (
    <ChatChartBlock source={block.source} incomplete={!block.closed} streaming={rest.streaming ?? false} copy={rest.codeCopy ?? true} />
  ), [rest.streaming, rest.codeCopy]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    return hydrateNoteMedia(host, noteId, attachments);
  }, [attachments, content, noteId]);

  return (
    <div ref={hostRef}>
      <InlinePreviewSchedulerProvider><MarkdownView
        content={noteMarkdownForRender(content)}
        mermaidActions
        {...rest}
        renderChart={renderChart}
        className={['markdown-note', rest.className].filter(Boolean).join(' ')}
      /></InlinePreviewSchedulerProvider>
    </div>
  );
}
