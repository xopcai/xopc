// Convert persisted follow-up attachment wire payloads back into composer
// `Attachment` shape (type/mimeType/content/...) so they can populate the
// composer when the user clicks "edit" on a pending follow-up.

import type { Attachment } from '@/features/chat/attachments/attachment-utils';
import type { PendingFollowUp } from '@/features/chat/follow-up/pending-follow-up.types';

export function wireFollowUpAttachmentsToComposer(
  wire: NonNullable<PendingFollowUp['attachments']>,
): Attachment[] {
  return wire.map((w) => ({
    type:
      w.type === 'voice'
        ? 'voice'
        : (w.mimeType ?? '').startsWith('image/')
          ? 'image'
          : 'document',
    mimeType: w.mimeType ?? 'application/octet-stream',
    content: w.data ?? '',
    name: w.name ?? 'file',
    size: w.size ?? 0,
    workspaceRelativePath: w.workspaceRelativePath,
    ...(typeof w.durationSeconds === 'number' &&
    Number.isFinite(w.durationSeconds) &&
    w.durationSeconds > 0
      ? { durationSeconds: w.durationSeconds }
      : {}),
  }));
}
