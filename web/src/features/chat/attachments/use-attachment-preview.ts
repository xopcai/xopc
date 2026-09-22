import { useCallback, useState } from 'react';

import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

export function useAttachmentPreview({
  layout,
  conversationId,
  workspaceConversationId,
  projectId,
}: {
  layout: 'user' | 'assistant';
  conversationId?: string | null;
  workspaceConversationId?: string | null;
  projectId?: string | null;
}) {
  const [active, setActive] = useState<MessageAttachment | null>(null);
  const setPreviewPath = useWorkspacePreviewStore((state) => state.setPath);

  const openAttachment = useCallback((attachment: MessageAttachment) => {
    const fileConversationId = workspaceConversationId ?? conversationId;
    if (
      layout === 'assistant'
      && attachment.workspaceRelativePath?.trim()
      && (projectId?.trim() || fileConversationId?.trim())
    ) {
      setPreviewPath(attachment.workspaceRelativePath.trim(), null, projectId, fileConversationId);
      return;
    }
    setActive(attachment);
  }, [conversationId, layout, projectId, setPreviewPath, workspaceConversationId]);

  const closePreview = useCallback(() => setActive(null), []);

  return {
    active,
    open: active !== null,
    openAttachment,
    closePreview,
  };
}
