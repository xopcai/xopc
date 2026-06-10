import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

import { parseNoteAttachmentTarget } from '@/features/notes/attachment-ref';
import { VoiceNotePlayer } from '@/features/notes/voice-note-player';

/**
 * Read-only audio NodeView for Tiptap.
 * Renders an inline VoiceMiniPlayer for audio attachment links.
 */
export function AudioBlock({ node }: NodeViewProps) {
  const { href, label } = node.attrs as { href: string; label?: string };

  const parsed = parseNoteAttachmentTarget(href);
  if (!parsed) {
    return (
      <NodeViewWrapper as="span" className="inline text-fg-muted italic text-sm">
        [audio unavailable]
      </NodeViewWrapper>
    );
  }

  const durationMatch = label?.match(/(\d+):(\d+)/);
  const durationSec = durationMatch
    ? Number(durationMatch[1]) * 60 + Number(durationMatch[2])
    : undefined;

  const attachment: import('@/features/notes/notes-api').NoteAttachment = {
    id: parsed.attachmentId,
    type: 'audio',
    mimeType: 'audio/webm',
    fileName: '',
    size: 0,
    relativePath: '',
    duration: durationSec,
  };

  return (
    <NodeViewWrapper className="my-3">
      <VoiceNotePlayer
        noteId={parsed.noteId}
        attachment={attachment}
        className="max-w-md"
      />
    </NodeViewWrapper>
  );
}
