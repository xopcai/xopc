import * as Dialog from '@radix-ui/react-dialog';
import { ExternalLink, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Skeleton } from '@/components/ui/skeleton';
import { getDiscussionForNote } from '@/features/discussions/discussion-api';
import type { DiscussionDetail } from '@/features/discussions/discussion-types';
import { withDetailReturnTo } from '@/lib/navigation-return';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { NoteMarkdownView } from './note-markdown-view';
import { getNote } from './notes-api';

function buildDiscussionPreviewMarkdown(detail: DiscussionDetail, personalMarkdown: string, zh: boolean): string {
  const sections: string[] = [];
  const org = detail.organization?.organization;
  if (org) {
    if (org.summary.trim()) {
      sections.push(`## ${zh ? '纪要摘要' : 'Summary'}\n\n${org.summary.trim()}`);
    }
    const keyPoints = (org.keyPointEvidence?.map((item) => item.text) ?? org.keyPoints)
      .map((item) => item.trim())
      .filter(Boolean);
    if (keyPoints.length > 0) {
      sections.push(`## ${zh ? '重点结论' : 'Key points'}\n\n${keyPoints.map((text) => `- ${text}`).join('\n')}`);
    }
    const decisions = org.decisions.filter((item) => !item.ignored && !item.supersededBy);
    if (decisions.length > 0) {
      sections.push(`## ${zh ? '已决定事项' : 'Decisions'}\n\n${decisions.map((item) => `- ${item.text}`).join('\n')}`);
    }
    const actions = org.actionItems.filter((item) => !item.ignored && !item.supersededBy);
    if (actions.length > 0) {
      sections.push(
        `## ${zh ? '下一步行动' : 'Next actions'}\n\n${actions
          .map((item) => {
            const meta = [item.owner, item.dueDate].filter(Boolean).join(' · ');
            return `- [ ] ${item.title}${meta ? ` (${meta})` : ''}`;
          })
          .join('\n')}`,
      );
    }
  } else if (detail.transcript.text.trim()) {
    sections.push(`## ${zh ? '转写原文' : 'Transcript'}\n\n${detail.transcript.text.trim()}`);
  }
  if (personalMarkdown.trim()) {
    sections.push(sections.length > 0 ? `## ${zh ? '我的笔记' : 'My notes'}\n\n${personalMarkdown.trim()}` : personalMarkdown.trim());
  }
  return sections.join('\n\n');
}

export function NotePreviewModal({ noteId, backgroundPath, onClose }: {
  noteId: string;
  backgroundPath: string;
  onClose: () => void;
}) {
  const language = useLocaleStore((state) => state.language);
  const token = useGatewayStore((state) => state.conversationId);
  const { data: note, error, isLoading } = useSWR(['note-preview', noteId, token], () => getNote(noteId));
  const { data: discussion, isLoading: discussionLoading } = useSWR(
    note?.kind === 'voice' ? ['note-preview-discussion', noteId, token] : null,
    () => getDiscussionForNote(noteId).catch(() => null),
  );
  const zh = language === 'zh';
  const rawTitle = note?.title?.trim() ?? '';
  const isPlaceholderVoiceTitle = note?.kind === 'voice' && /^Discussion · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(rawTitle);
  const title = (isPlaceholderVoiceTitle ? discussion?.organization?.organization?.title?.trim() : rawTitle)
    || rawTitle
    || (zh ? '笔记预览' : 'Note preview');
  const closeLabel = zh ? '关闭笔记预览' : 'Close note preview';
  const previewMarkdown = discussion
    ? buildDiscussionPreviewMarkdown(discussion, note?.markdown ?? '', zh)
    : (note?.markdown ?? '');
  const busy = isLoading || (note?.kind === 'voice' && !note.markdown.trim() && discussionLoading);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/45" />
        <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[90] flex h-[min(48rem,calc(100dvh-2rem))] w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay focus:outline-none">
          <header className="flex shrink-0 items-center gap-3 border-b border-edge bg-surface-panel px-5 py-3.5">
            <Dialog.Title className="min-w-0 flex-1 truncate font-medium text-fg" title={title}>{title}</Dialog.Title>
            <Dialog.Description className="sr-only">{zh ? '预览笔记内容，或打开编辑器。' : 'Preview the note or open it in the editor.'}</Dialog.Description>
            <Link
              to={withDetailReturnTo(`/notes/${encodeURIComponent(noteId)}`, backgroundPath)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-accent hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ExternalLink className="size-4" aria-hidden />
              <span>{zh ? '打开编辑' : 'Open in editor'}</span>
            </Link>
            <Dialog.Close title={closeLabel} aria-label={closeLabel} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent">
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:p-8" aria-busy={busy}>
            {busy ? (
              <div className="space-y-4" role="status" aria-label={zh ? '正在加载笔记' : 'Loading note'}>
                <Skeleton className="h-7 w-2/3" />
                <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" /><Skeleton className="mt-8 h-32 w-full" />
              </div>
            ) : error ? (
              <p role="alert" className="text-sm text-fg-muted">{zh ? '笔记加载失败，请重新打开预览。' : 'Unable to load the note. Please reopen the preview.'}</p>
            ) : !note ? (
              <p className="text-sm text-fg-muted">{zh ? '笔记不存在或已删除。' : 'This note is unavailable or has been deleted.'}</p>
            ) : previewMarkdown.trim() ? (
              <NoteMarkdownView key={noteId} noteId={noteId} content={previewMarkdown} mermaidActions={false} />
            ) : (
              <p className="text-sm text-fg-muted">{zh ? '暂无笔记内容。' : 'This note has no content yet.'}</p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
