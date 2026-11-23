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

/**
 * Toggle the Nth GFM task list checkbox (`- [ ]` / `- [x]`) in Markdown source,
 * skipping fenced code blocks so code snippets containing `- [ ]` are untouched.
 */
export function toggleMarkdownTaskAtIndex(
  markdown: string,
  targetIndex: number,
  checked: boolean,
): string {
  const lines = markdown.split('\n');
  let fenceChar: string | null = null;
  let fenceLen = 0;
  let seen = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const seq = fenceMatch[1];
      const ch = seq[0];
      if (!fenceChar) {
        fenceChar = ch;
        fenceLen = seq.length;
      } else if (ch === fenceChar && seq.length >= fenceLen && /^ {0,3}[`~]+\s*$/.test(line)) {
        fenceChar = null;
        fenceLen = 0;
      }
      continue;
    }
    if (fenceChar) continue;

    const taskMatch = /^(\s*(?:[-+*]|\d+[.)])\s+\[)([ xX])(\].*)$/.exec(line);
    if (!taskMatch) continue;
    if (seen === targetIndex) {
      lines[i] = `${taskMatch[1]}${checked ? 'x' : ' '}${taskMatch[3]}`;
      return lines.join('\n');
    }
    seen += 1;
  }
  return markdown;
}

export type NoteMarkdownViewProps = MarkdownViewProps & {
  noteId?: string;
  attachments?: NoteAttachment[];
  onToggleTaskIndex?: (taskIndex: number, checked: boolean) => void;
};

export function NoteMarkdownView({
  content,
  noteId,
  attachments,
  onToggleTaskIndex,
  ...rest
}: NoteMarkdownViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef(onToggleTaskIndex);
  toggleRef.current = onToggleTaskIndex;
  const renderChart = useCallback((block: MarkdownChartBlock) => (
    <ChatChartBlock source={block.source} incomplete={!block.closed} streaming={rest.streaming ?? false} copy={rest.codeCopy ?? true} />
  ), [rest.streaming, rest.codeCopy]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const cleanupMedia = hydrateNoteMedia(host, noteId, attachments);
    const checkboxCleanups: Array<() => void> = [];
    if (toggleRef.current) {
      const markers = host.querySelectorAll<HTMLElement>('.markdown-body [data-md-task]');
      markers.forEach((marker, idx) => {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = marker.getAttribute('data-md-task') === 'checked';
        checkbox.className = 'mr-2 size-4 cursor-pointer align-middle accent-accent';
        marker.replaceWith(checkbox);
        const onChange = () => {
          toggleRef.current?.(idx, checkbox.checked);
        };
        checkbox.addEventListener('change', onChange);
        checkboxCleanups.push(() => checkbox.removeEventListener('change', onChange));
      });
    }
    return () => {
      cleanupMedia();
      for (const fn of checkboxCleanups) fn();
    };
  }, [attachments, content, noteId, Boolean(onToggleTaskIndex)]);

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
