import { randomUUID } from 'expo-crypto';

import type { ComposerAttachment } from './composer.types';
import type { PendingFollowUp } from './pending-follow-up.types';

export function wireFollowUpAttachmentsToComposer(
  wire: NonNullable<PendingFollowUp['attachments']>,
): ComposerAttachment[] {
  return wire
    .filter((w) => w.data?.trim())
    .map((w, index) => ({
      id: `followup-${index}-${w.name ?? 'file'}`,
      type: (w.mimeType ?? '').startsWith('image/') ? 'image' as const : 'document' as const,
      mimeType: w.mimeType ?? 'application/octet-stream',
      content: w.data ?? '',
      name: w.name ?? 'attachment',
      size: w.size ?? 0,
    }));
}

export function newFollowUpRowId(): string {
  return randomUUID();
}
