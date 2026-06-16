import { useState } from 'react';

import { AttachmentPreviewDialog } from '@/features/chat/attachments/attachment-preview-dialog';
import { AttachmentTile } from '@/features/chat/attachments/attachment-tile';
import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import { VoiceMessageBar } from '@/features/chat/composer/voice-message-bar';
import { cn } from '@/lib/cn';

function isAudioAttachment(att: MessageAttachment): boolean {
  return (
    att.type === 'voice' ||
    att.type === 'audio' ||
    att.mimeType?.startsWith('audio/') === true
  );
}

const IMAGE_GRID_MAX_VISIBLE = 9;

function imageGridLayout(
  count: number,
  compact: boolean,
): {
  container: string;
  tileSize: 'single' | 'grid-cell';
  overflowCount?: number;
} {
  const maxW = compact ? 'max-w-[11rem]' : 'max-w-52';
  const gap = 'gap-1';

  if (count === 1) {
    return {
      container: `grid grid-cols-1 ${maxW} ${gap}`,
      tileSize: 'single',
    };
  }
  if (count === 2) {
    return {
      container: `grid grid-cols-2 ${maxW} ${gap}`,
      tileSize: 'grid-cell',
    };
  }
  if (count === 3) {
    return {
      container: `grid grid-cols-3 ${maxW} ${gap}`,
      tileSize: 'grid-cell',
    };
  }
  if (count === 4) {
    return {
      container: `grid grid-cols-2 ${maxW} ${gap}`,
      tileSize: 'grid-cell',
    };
  }
  if (count <= IMAGE_GRID_MAX_VISIBLE) {
    return {
      container: `grid grid-cols-3 ${maxW} ${gap}`,
      tileSize: 'grid-cell',
    };
  }
  return {
    container: `grid grid-cols-3 ${maxW} ${gap}`,
    tileSize: 'grid-cell',
    overflowCount: count - (IMAGE_GRID_MAX_VISIBLE - 1),
  };
}

export function AttachmentRenderer({
  attachments,
  authToken,
  sessionKey,
  layout = 'assistant',
  centerUserVoiceRow = false,
}: {
  attachments: MessageAttachment[];
  authToken?: string;
  sessionKey?: string | null;
  /** User bubbles align voice pills to the right (WeChat-style). */
  layout?: 'user' | 'assistant';
  /** When text is empty (attachment-only bubble), center audio so horizontal padding reads even. */
  centerUserVoiceRow?: boolean;
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
      <div className="flex flex-col gap-2">
        {images.length > 0 ? (
          (() => {
            const grid = imageGridLayout(images.length, layout === 'user');
            const visibleImages =
              grid.overflowCount != null
                ? images.slice(0, IMAGE_GRID_MAX_VISIBLE - 1)
                : images;

            return (
              <div className={cn('w-full min-w-0', grid.container)}>
                {visibleImages.map((img, i) => (
                  <AttachmentTile
                    key={img.id ?? `${img.name}-${i}`}
                    attachment={img}
                    authToken={authToken}
                    sessionKey={sessionKey}
                    imageSize={grid.tileSize}
                    compact={layout === 'user'}
                    onOpen={(att) => {
                      setActive(att);
                      setOpen(true);
                    }}
                  />
                ))}
                {grid.overflowCount != null ? (
                  <AttachmentTile
                    key={
                      images[IMAGE_GRID_MAX_VISIBLE - 1]?.id ??
                      `overflow-${IMAGE_GRID_MAX_VISIBLE - 1}`
                    }
                    attachment={images[IMAGE_GRID_MAX_VISIBLE - 1]}
                    authToken={authToken}
                    sessionKey={sessionKey}
                    imageSize="grid-cell"
                    compact={layout === 'user'}
                    gridCellFill="square"
                    overflowLabel={`+${grid.overflowCount}`}
                    onOpen={(att) => {
                      setActive(att);
                      setOpen(true);
                    }}
                  />
                ) : null}
              </div>
            );
          })()
        ) : null}
        {audioItems.length > 0 ? (
          <div
            className={cn(
              'flex flex-col gap-2',
              layout === 'user' &&
                (centerUserVoiceRow ? 'items-center' : 'items-end'),
            )}
          >
            {audioItems.map((a, i) => (
              <VoiceMessageBar
                key={a.id ?? `${a.name}-${i}`}
                att={a}
                sessionKey={sessionKey}
                align={
                  layout === 'user'
                    ? centerUserVoiceRow
                      ? 'center'
                      : 'end'
                    : 'start'
                }
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
                sessionKey={sessionKey}
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
        sessionKey={sessionKey}
        onClose={() => {
          setOpen(false);
          setActive(null);
        }}
      />
    </>
  );
}
