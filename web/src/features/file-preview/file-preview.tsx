import { useContext, useEffect, useRef, useState } from 'react';
import { readPreviewView, savePreviewView } from '@/features/preview-runtime/preview-view-state';
import { referenceFileInComposer } from '@/features/chat/composer/composer-file-reference';
import { WorkspaceFileTargetsContext } from '@/features/right-workspace/workspace-context';
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
    conversationId?: string | null;
    projectId?: string | null;
    agentId?: string;
    disabled?: boolean;
  };
};

/** Every file preview renders its header and content through this single composition. */
export function FilePreview({ header, chat, ...source }: FilePreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const restore = () => {
      const scroll = readPreviewView(source.descriptor.id).scroll;
      node.querySelectorAll<HTMLElement>('[class*="overflow-auto"], [class*="overflow-y-auto"], .cm-scroller').forEach((el, i) => { if (scroll[i] != null) el.scrollTop = scroll[i]; });
    };
    const frame = requestAnimationFrame(restore);
    const observer = typeof MutationObserver !== 'undefined' ? new MutationObserver(restore) : null;
    observer?.observe(node, { childList: true, subtree: true });
    const track = () => savePreviewView(source.descriptor.id, { scroll: [...node.querySelectorAll<HTMLElement>('[class*="overflow-auto"], [class*="overflow-y-auto"], .cm-scroller')].map((el) => el.scrollTop) });
    node.addEventListener('scroll', track, true);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); node.removeEventListener('scroll', track, true); };
  }, [source.descriptor.id]);
  const targets = useContext(WorkspaceFileTargetsContext);
  const [referencing, setReferencing] = useState(false);
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
        chat.conversationId ? getSessionDetail(chat.conversationId).catch(() => null) : Promise.resolve(null),
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
    <div ref={rootRef} className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
      <FilePreviewHeader
        key={source.descriptor.id}
        {...header}
        name={source.descriptor.fileName}
        filePath={source.descriptor.source.kind === 'workspace' ? source.descriptor.source.path : undefined}
        controller={controller}
        actions={source.actions}
        referenceActions={chat ? targets.map((target) => ({ label: target.label, disabled: referencing || source.loading || Boolean(source.loadError) || chat.disabled,
          onClick: async () => {
            if (referencing) return;
            setReferencing(true);
            try {
              const file = await chat.createFile();
              const ok = await referenceFileInComposer(target.id, file);
              showComposerNotification(ok ? 'success' : 'warning', source.language === 'zh' ? (ok ? '已添加到目标聊天草稿' : '未能添加附件，请确认目标聊天可用及附件限制') : (ok ? 'Added to the target chat draft' : 'Could not add attachment. Check the target chat and attachment limits.'));
            } catch {
              showComposerNotification('error', source.language === 'zh' ? '文件引用失败，原草稿已保留' : 'Could not reference file. Your draft is retained.');
            } finally { setReferencing(false); }
          },
        })) : undefined}
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
