import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { formatFileSize } from '@/features/chat/attachments/attachment-utils';
import { createComposerAttachmentHandoff } from '@/features/chat/composer/composer-attachment-handoff';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { MAX_WEBCHAT_ATTACHMENT_FILE_BYTES } from '@/features/chat/constants';
import { FilePreviewHeader, type FilePreviewHeaderProps } from '@/features/file-preview/file-preview-header';
import { PreviewRuntimeView, usePreviewRuntimeController } from '@/features/preview-runtime/preview-runtime';
import type { PreviewRuntimeRenderProps } from '@/features/preview-runtime/preview-types';
import { getSessionDetail } from '@/features/sessions/session-api';
import { messages } from '@/i18n/messages';

type FilePreviewProps = PreviewRuntimeRenderProps & {
  header: Omit<FilePreviewHeaderProps, 'name' | 'controller' | 'actions' | 'editInNewChat'>;
  chat?: {
    createFile: () => Promise<File>;
    sessionKey?: string | null;
    projectId?: string | null;
    agentId?: string;
    disabled?: boolean;
  };
};

/** Every file preview renders its header and content through this single composition. */
export function FilePreview({ header, chat, ...source }: FilePreviewProps) {
  const controller = usePreviewRuntimeController(source.descriptor);
  const navigate = useNavigate();
  const m = messages(source.language);
  const [handoffLoading, setHandoffLoading] = useState(false);

  const editInNewChat = async () => {
    if (!chat || handoffLoading) return;
    setHandoffLoading(true);
    try {
      const [file, session] = await Promise.all([
        chat.createFile(),
        chat.sessionKey ? getSessionDetail(chat.sessionKey).catch(() => null) : Promise.resolve(null),
      ]);
      if (file.size > MAX_WEBCHAT_ATTACHMENT_FILE_BYTES) {
        showComposerNotification('warning', m.chat.attachmentFileTooLarge, {
          name: file.name,
          maxSize: formatFileSize(MAX_WEBCHAT_ATTACHMENT_FILE_BYTES),
        });
        return;
      }
      const params = new URLSearchParams({ attachmentHandoff: createComposerAttachmentHandoff(file) });
      const projectId = chat.projectId?.trim() || session?.projectId?.trim();
      const agentId = chat.agentId?.trim() || session?.routing?.agentId?.trim();
      if (projectId) params.set('projectId', projectId);
      navigate({ pathname: '/chat/new', search: `?${params}` }, {
        state: { forceNewChat: true, agentId: agentId || undefined },
      });
      header.onClose();
    } catch {
      showComposerNotification('error', m.workspace.editInNewChatFailed);
    } finally {
      setHandoffLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-panel">
      <FilePreviewHeader
        key={source.descriptor.id}
        {...header}
        name={source.descriptor.fileName}
        controller={controller}
        actions={source.actions}
        editInNewChat={chat ? {
          onClick: () => void editInNewChat(),
          loading: handoffLoading,
          disabled: source.loading || Boolean(source.loadError) || chat.disabled,
        } : undefined}
      />
      <PreviewRuntimeView {...source} controller={controller} />
    </div>
  );
}
