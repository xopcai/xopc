import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import { Download, MoreHorizontal, RefreshCw, SquarePen, Sparkles, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { PageContextCaptureButton } from '@/features/chat/context/page-context-capture-button';
import { apiUrl } from '@/lib/url';
import type { DiscussionDetail, DiscussionTemplate } from './discussion-types';

export interface DiscussionNoteManagementActions {
  onAnalyze: () => void; onChat: () => void; onShare: () => void; onHistory: () => void; onDelete: () => void;
  busy: boolean;
}

export function DiscussionTools({ detail, template, onTemplate, zh, busy, processing, pageText, editing, onOrganize, onRegenerate, onPersonalNotes, noteActions }: {
  detail: DiscussionDetail; template: DiscussionTemplate; onTemplate: (value: DiscussionTemplate) => void;
  zh: boolean; busy: boolean; processing: boolean; pageText: string; editing: boolean;
  noteActions?: DiscussionNoteManagementActions;
  onOrganize: () => void; onRegenerate: () => void; onPersonalNotes?: () => void;
}) {
  const [open,setOpen] = useState(false);
  const action = (work: () => void) => { setOpen(false); work(); };
  const base = `/api/discussions/${encodeURIComponent(detail.discussion.id)}`;
  const audio = !!detail.discussion.audioAttachmentId && !detail.discussion.audioDeletedAt;
  return <Popover.Root open={open} onOpenChange={setOpen}><Popover.Trigger asChild><button type="button" aria-label={zh ? '更多笔记操作' : 'More note actions'} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><MoreHorizontal className="size-5" aria-hidden /></button></Popover.Trigger>
    <Popover.Portal><Popover.Content align="end" sideOffset={6} collisionPadding={12} aria-label={zh ? '笔记工具' : 'Note tools'} className="z-[140] max-h-[min(38rem,var(--radix-popover-content-available-height,85dvh))] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-edge bg-surface-overlay p-3 text-fg shadow-elevated">
      {onPersonalNotes ? <Button className="min-h-11 w-full justify-start" onClick={() => action(onPersonalNotes)}><SquarePen className="size-4" />{zh ? '添加我的补充' : 'Add my notes'}</Button> : null}
      {noteActions ? <>
        <Button className="min-h-11 w-full justify-start" disabled={noteActions.busy} onClick={() => action(noteActions.onAnalyze)}><Sparkles className="size-4" />{zh ? '进一步分析' : 'Analyze this note'}</Button>
        <Button className="min-h-11 w-full justify-start" disabled={noteActions.busy} onClick={() => action(noteActions.onChat)}><MessageCircle className="size-4" />{zh ? '就这篇笔记提问' : 'Ask about this note'}</Button>
      </> : null}
      <div className="space-y-2 py-3">
        <p className="px-2 text-xs text-fg-muted">{zh ? '整理笔记' : 'Organize notes'}</p>
        <Select value={template} aria-label={zh ? '纪要模板' : 'Summary template'} onChange={event => onTemplate(event.target.value as DiscussionTemplate)}>
          <SelectOption value="general">{zh ? '通用会议' : 'General'}</SelectOption><SelectOption value="project">{zh ? '项目例会' : 'Project'}</SelectOption><SelectOption value="review">{zh ? '需求评审' : 'Review'}</SelectOption><SelectOption value="interview">{zh ? '客户访谈' : 'Interview'}</SelectOption>
        </Select>
        <Button className="min-h-11 w-full justify-start" disabled={busy || processing || !detail.discussion.canonicalTranscript} onClick={() => action(onOrganize)}><RefreshCw className="size-4" />{zh ? '重新整理纪要' : 'Regenerate summary'}</Button>
        {audio && ['completed','needs_attention'].includes(detail.discussion.status) ? <Button className="min-h-11 w-full justify-start" disabled={busy || processing} onClick={() => action(onRegenerate)}>{zh ? '从原音重新生成' : 'Regenerate from audio'}</Button> : null}
      </div>
      <div className="space-y-2 border-t border-edge-subtle py-3">
        <p className="px-2 text-xs text-fg-muted">{zh ? '导出与分享' : 'Export and share'}</p>
        {audio ? <a className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" href={apiUrl(`${base}/audio`)} download><Download className="size-4" />{zh ? '下载录音' : 'Download recording'}</a> : null}
        {noteActions ? <Button className="min-h-11 w-full justify-start" disabled={noteActions.busy} onClick={() => action(noteActions.onShare)}>{zh ? '分享笔记' : 'Share note'}</Button> : null}
        <div className="flex flex-wrap gap-2">{['md','txt','srt'].map(format => <a key={format} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-accent-fg hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" href={apiUrl(`${base}/export?format=${format}`)} download>{format.toUpperCase()}</a>)}</div>
        <PageContextCaptureButton resource={{ kind: 'note',id: detail.note.id,revision: String(detail.note.remoteVersion ?? 1) }} selection={{ text: pageText,draft: false }} label={zh ? '带到新对话' : 'Use in a new chat'} disabled={busy || processing || editing || !pageText || pageText.length > 16000} />
        <p className="px-2 text-xs leading-5 text-fg-muted">{pageText.length > 16000 ? (zh ? '内容较长，请先筛选部分原文。' : 'Filter the transcript to share a smaller selection.') : (zh ? '分享当前显示的文字，不包含原音。' : 'Shares displayed text, without audio.')}</p>
      </div>
      {noteActions ? <div className="space-y-1 border-t border-edge-subtle pt-2">
        <Button className="min-h-11 w-full justify-start" onClick={() => action(noteActions.onHistory)}>{zh ? '版本历史' : 'Version history'}</Button>
        <Button className="min-h-11 w-full justify-start text-danger" disabled={noteActions.busy} onClick={() => action(noteActions.onDelete)}>{zh ? '删除笔记' : 'Delete note'}</Button>
      </div> : null}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
