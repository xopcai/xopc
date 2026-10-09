import * as Dialog from '@radix-ui/react-dialog';
import { ExternalLink, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Skeleton } from '@/components/ui/skeleton';
import { withDetailReturnTo } from '@/lib/navigation-return';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { NoteMarkdownView } from './note-markdown-view';
import { getNote } from './notes-api';

export function NotePreviewModal({ noteId, backgroundPath, onClose }: {
  noteId: string;
  backgroundPath: string;
  onClose: () => void;
}) {
  const language = useLocaleStore((state) => state.language);
  const token = useGatewayStore((state) => state.conversationId);
  const { data: note, error, isLoading } = useSWR(['note-preview', noteId, token], () => getNote(noteId));
  const zh = language === 'zh';
  const title = note?.title?.trim() || (zh ? '笔记预览' : 'Note preview');
  const closeLabel = zh ? '关闭笔记预览' : 'Close note preview';

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-[1px]" />
        <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[90] flex h-[min(48rem,calc(100dvh-2rem))] w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay focus:outline-none">
          <header className="flex shrink-0 items-center gap-3 border-b border-edge bg-surface-panel px-5 py-3.5">
            <Dialog.Title className="min-w-0 flex-1 truncate font-medium text-fg" title={title}>{title}</Dialog.Title>
            <Dialog.Description className="sr-only">{zh ? '预览笔记内容，或打开独立页面。' : 'Preview the note or open its full page.'}</Dialog.Description>
            <Link
              to={withDetailReturnTo(`/notes/${encodeURIComponent(noteId)}`, backgroundPath)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-accent hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ExternalLink className="size-4" aria-hidden />
              <span>{zh ? '打开独立页面' : 'Open full page'}</span>
            </Link>
            <Dialog.Close title={closeLabel} aria-label={closeLabel} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent">
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:p-8" aria-busy={isLoading}>
            {isLoading ? (
              <div className="space-y-4" role="status" aria-label={zh ? '正在加载笔记' : 'Loading note'}>
                <Skeleton className="h-7 w-2/3" />
                <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" /><Skeleton className="mt-8 h-32 w-full" />
              </div>
            ) : error ? (
              <p role="alert" className="text-sm text-fg-muted">{zh ? '笔记加载失败，请重新打开预览。' : 'Unable to load the note. Please reopen the preview.'}</p>
            ) : !note ? (
              <p className="text-sm text-fg-muted">{zh ? '笔记不存在或已删除。' : 'This note is unavailable or has been deleted.'}</p>
            ) : note.markdown.trim() ? (
              <NoteMarkdownView key={noteId} noteId={noteId} content={note.markdown} mermaidActions={false} />
            ) : (
              <p className="text-sm text-fg-muted">{zh ? '暂无笔记内容。' : 'This note has no content yet.'}</p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
