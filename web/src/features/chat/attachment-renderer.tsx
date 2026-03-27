import { useState } from 'react';

import { AttachmentPreviewDialog } from '@/features/chat/attachment-preview-dialog';
import { AttachmentTile } from '@/features/chat/attachment-tile';
import type { MessageAttachment } from '@/features/chat/messages.types';
import { VoiceMessageBar } from '@/features/chat/voice-message-bar';
import { cn } from '@/lib/cn';

function isAudioAttachment(att: MessageAttachment): boolean {
  return (
    att.type === 'voice' ||
    att.type === 'audio' ||
    att.mimeType?.startsWith('audio/') === true
  );
}

export function AttachmentRenderer({
  attachments,
  authToken,
  layout = 'assistant',
}: {
  attachments: MessageAttachment[];
  authToken?: string;
  /** User bubbles align voice pills to the right (WeChat-style). */
  layout?: 'user' | 'assistant';
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<MessageAttachment | null>(null);

  if (!attachments?.length) return null;

  const images = attachments.filter(
    (att) => att.type === 'image' || att.mimeType?.startsWith('image/'),
  );
  const audioItems = attachments.filter(isAudioAttachment);
  const documents = attachments.filter(
    (att) =>
      att.type !== 'image' &&
      !att.mimeType?.startsWith('image/') &&
      !isAudioAttachment(att),
  );

  return (
    <>
      <div className="mt-2 flex flex-col gap-2">
        {images.length > 0 ? (
          <div
            className={cn(
              'grid w-full max-w-40 gap-1',
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
        {audioItems.length > 0 ? (
          <div className={cn('flex flex-col gap-2', layout === 'user' && 'w-full items-end')}>
            {audioItems.map((a, i) => (
              <VoiceMessageBar
                key={a.id ?? `${a.name}-${i}`}
                att={a}
                align={layout === 'user' ? 'end' : 'start'}
                variant={layout === 'user' ? 'compact' : 'default'}
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
