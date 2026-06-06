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

function imageGridLayout(count: number): {
  container: string;
  tileSize: 'single' | 'grid-cell';
  itemClass?: (index: number) => string | undefined;
  gridCellFill?: (index: number) => 'square' | 'stretch' | undefined;
  overflowCount?: number;
} {
  if (count === 1) {
    return {
      container: 'grid max-w-xs grid-cols-1 gap-1.5',
      tileSize: 'single',
    };
  }
  if (count === 2) {
    return {
      container: 'grid max-w-xs grid-cols-2 gap-1.5',
      tileSize: 'grid-cell',
    };
  }
  if (count === 3) {
    return {
      container: 'grid h-44 max-w-xs grid-cols-2 grid-rows-2 gap-1.5 sm:h-48',
      tileSize: 'grid-cell',
      itemClass: (index) => (index === 0 ? 'row-span-2 min-h-0' : undefined),
      gridCellFill: (index) => (index === 0 ? 'stretch' : 'square'),
    };
  }
  if (count === 4) {
    return {
      container: 'grid max-w-xs grid-cols-2 gap-1.5',
      tileSize: 'grid-cell',
    };
  }
  if (count <= IMAGE_GRID_MAX_VISIBLE) {
    return {
      container: 'grid max-w-xs grid-cols-3 gap-1.5',
      tileSize: 'grid-cell',
    };
  }
  return {
    container: 'grid max-w-xs grid-cols-3 gap-1.5',
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
            const layout = imageGridLayout(images.length);
            const visibleImages =
              layout.overflowCount != null
                ? images.slice(0, IMAGE_GRID_MAX_VISIBLE - 1)
                : images;

            return (
              <div className={cn('w-full', layout.container)}>
                {visibleImages.map((img, i) => (
                  <AttachmentTile
                    key={img.id ?? `${img.name}-${i}`}
                    attachment={img}
                    authToken={authToken}
                    sessionKey={sessionKey}
                    imageSize={layout.tileSize}
                    gridCellFill={layout.gridCellFill?.(i)}
                    className={layout.itemClass?.(i)}
                    onOpen={(att) => {
                      setActive(att);
                      setOpen(true);
                    }}
                  />
                ))}
                {layout.overflowCount != null ? (
                  <AttachmentTile
                    key={
                      images[IMAGE_GRID_MAX_VISIBLE - 1]?.id ??
                      `overflow-${IMAGE_GRID_MAX_VISIBLE - 1}`
                    }
                    attachment={images[IMAGE_GRID_MAX_VISIBLE - 1]!}
                    authToken={authToken}
                    sessionKey={sessionKey}
                    imageSize="grid-cell"
                    gridCellFill="square"
                    overflowLabel={`+${layout.overflowCount}`}
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
