import { ImageOff } from 'lucide-react';
import { useState } from 'react';

import { buildNoteAttachmentRef } from '@/features/notes/attachment-ref';
import { AuthenticatedImage } from '@/features/notes/authenticated-image';
import { cn } from '@/lib/cn';

export type NoteCoverThumbnailProps = {
  noteId: string;
  attachmentId: string;
  className?: string;
};

export function NoteCoverThumbnail({ noteId, attachmentId, className }: NoteCoverThumbnailProps) {
  const [failed, setFailed] = useState(false);
  const src = buildNoteAttachmentRef(noteId, attachmentId);

  if (failed) {
    return (
      <div
        className={cn(
          'flex size-12 shrink-0 items-center justify-center rounded-lg border border-edge-subtle bg-surface-hover text-fg-muted',
          className,
        )}
        aria-hidden
      >
        <ImageOff className="size-4" />
      </div>
    );
  }

  return (
    <AuthenticatedImage
      src={src}
      expectedNoteId={noteId}
      alt=""
      loading="lazy"
      draggable={false}
      onLoadFailed={() => setFailed(true)}
      className={cn(
        'size-12 shrink-0 rounded-lg border border-edge-subtle bg-surface-hover object-cover',
        className,
      )}
    />
  );
}
