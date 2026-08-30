import type { MediaRef } from '../media/types.js';
import type { TurnContextRef } from '../agent/source-context/types.js';

export interface UserTurnAttachment {
  id?: string;
  type: string;
  mimeType?: string;
  data?: string;
  uri?: string;
  name?: string;
  size?: number;
  workspaceRelativePath?: string;
  durationSeconds?: number;
}

export interface UserTurnInput {
  text: string;
  attachments?: UserTurnAttachment[];
  contextRefs?: TurnContextRef[];
}

export function mediaRefsToUserTurnAttachments(media: MediaRef[] | undefined): UserTurnAttachment[] | undefined {
  if (!media?.length) return undefined;
  return media.map((ref) => ({
    id: ref.id,
    type: ref.type,
    mimeType: ref.mimeType,
    uri: ref.uri,
    name: ref.name,
    size: ref.size,
  }));
}
