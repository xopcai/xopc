import { useLayoutEffect, useRef } from 'react';

import { MarkdownView, type MarkdownViewProps } from '@/components/markdown/markdown-view';

import { parseNoteAttachmentTarget } from './attachment-ref';
import { acquireNoteMediaObjectUrl, releaseNoteMediaObjectUrl } from './note-media-blob';

/** Rewrite canonical refs to API paths for marked HTML generation, then hydrate via blob fetch. */
function noteMarkdownForRender(content: string): string {
  return content.replace(
    /xopc-attachment:\/\/notes\/([^/]+)\/([^)\s]+)/gi,
    '/api/notes/$1/media/$2',
  );
}

function hydrateNoteMedia(root: HTMLElement, noteId?: string): () => void {
  const cleanups: Array<() => void> = [];

  root.querySelectorAll<HTMLImageElement>('.markdown-body img').forEach((img) => {
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
};

export function NoteMarkdownView({ content, noteId, ...rest }: NoteMarkdownViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    return hydrateNoteMedia(host, noteId);
  }, [content, noteId]);

  return (
    <div ref={hostRef}>
      <MarkdownView content={noteMarkdownForRender(content)} {...rest} />
    </div>
  );
}
