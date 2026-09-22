import { AttachmentPreviewDialog } from '@/features/chat/attachments/attachment-preview-dialog';
import { AttachmentTile } from '@/features/chat/attachments/attachment-tile';
import { useAttachmentPreview } from '@/features/chat/attachments/use-attachment-preview';
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
  conversationId,
  workspaceConversationId,
  projectId,
  layout = 'assistant',
  centerUserVoiceRow = false,
}: {
  attachments: MessageAttachment[];
  authToken?: string;
  conversationId?: string | null;
  workspaceConversationId?: string | null;
  projectId?: string | null;
  /** User bubbles align voice messages to the right (WeChat-style). */
  layout?: 'user' | 'assistant';
  /** When text is empty (attachment-only bubble), center audio so horizontal padding reads even. */
  centerUserVoiceRow?: boolean;
}) {
  const preview = useAttachmentPreview({
    layout,
    conversationId,
    workspaceConversationId,
    projectId,
  });

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
                    conversationId={conversationId}
                    imageSize={grid.tileSize}
                    compact={layout === 'user'}
                    onOpen={preview.openAttachment}
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
                    conversationId={conversationId}
                    imageSize="grid-cell"
                    compact={layout === 'user'}
                    overflowLabel={`+${grid.overflowCount}`}
                    onOpen={preview.openAttachment}
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
                conversationId={conversationId}
                align={
                  layout === 'user'
                    ? centerUserVoiceRow
                      ? 'center'
                      : 'end'
                    : 'start'
                }
                embedded={layout === 'user'}
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
                conversationId={conversationId}
                onOpen={preview.openAttachment}
              />
            ))}
          </div>
        ) : null}
      </div>

      <AttachmentPreviewDialog
        open={preview.open}
        attachment={preview.active}
        authToken={authToken}
        conversationId={conversationId}
        onClose={preview.closePreview}
      />
    </>
  );
}
