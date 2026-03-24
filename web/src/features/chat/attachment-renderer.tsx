import { useState } from 'react';

import { AttachmentPreviewDialog } from '@/features/chat/attachment-preview-dialog';
import { AttachmentTile } from '@/features/chat/attachment-tile';
import type { MessageAttachment } from '@/features/chat/messages.types';
import { cn } from '@/lib/cn';

export function AttachmentRenderer({
  attachments,
  authToken,
}: {
  attachments: MessageAttachment[];
  authToken?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<MessageAttachment | null>(null);

  if (!attachments?.length) return null;

  const images = attachments.filter(
    (att) => att.type === 'image' || att.mimeType?.startsWith('image/'),
  );
  const documents = attachments.filter(
    (att) => att.type !== 'image' && !att.mimeType?.startsWith('image/'),
  );

  return (
    <>
      <div className="mt-2 flex flex-col gap-2">
        {images.length > 0 ? (
          <div
            className={cn(
              'grid gap-2',
              images.length === 1 && 'grid-cols-1',
              images.length === 2 && 'grid-cols-2',
              images.length >= 3 && 'grid-cols-2 sm:grid-cols-3',
            )}
          >
            {images.map((img, i) => (
              <AttachmentTile
                key={img.id ?? `${img.name}-${i}`}
                attachment={img}
                authToken={authToken}
                onOpen={(att) => {
                  setActive(att);
                  setOpen(true);
                }}
              />
            ))}
          </div>
        ) : null}
        {documents.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {documents.map((doc, i) => (
              <AttachmentTile
                key={doc.id ?? `${doc.name}-${i}`}
                attachment={doc}
                authToken={authToken}
                onOpen={(att) => {
                  setActive(att);
                  setOpen(true);
                }}
              />
            ))}
          </div>
        ) : null}
      </div>

      <AttachmentPreviewDialog
        open={open}
        attachment={active}
        authToken={authToken}
        onClose={() => {
          setOpen(false);
          setActive(null);
        }}
      />
    </>
  );
}
