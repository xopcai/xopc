import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEffect, useState } from 'react';
import { AlignLeft, Download, MoreHorizontal, RefreshCw, Sparkles, MessageCircle, Share2, History, Trash2, SlidersHorizontal, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { PageContextCaptureButton } from '@/features/chat/context/page-context-capture-button';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import type { DiscussionCaptureSettings, DiscussionDetail, DiscussionTemplate } from './discussion-types';

async function triggerAuthenticatedDownload(url: string, fallbackFileName: string): Promise<void> {
  const response = await apiFetch(url);
  if (!response.ok) return;
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fallbackFileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

export interface DiscussionNoteManagementActions {
  onAnalyze: () => void; onChat: () => void; onShare: () => void; onHistory: () => void; onDelete: () => void;
  busy: boolean; chatOpen?: boolean; onOutline?: () => void;
}

const menuClass = 'z-[140] min-w-44 rounded-lg border border-edge bg-surface-overlay p-1 text-sm text-fg shadow-popover';
const rowClass = 'flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 outline-none focus:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-40';

export function DiscussionTools({ detail, zh, busy, processing, pageText, editing, noteActions }: {
  detail: DiscussionDetail; zh: boolean; busy: boolean; processing: boolean; pageText: string; editing: boolean;
  noteActions?: DiscussionNoteManagementActions;
}) {
  const base = `/api/discussions/${encodeURIComponent(detail.discussion.id)}`;
  const audio = !!detail.discussion.audioAttachmentId && !detail.discussion.audioDeletedAt;
  const iconClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  return <div className="flex flex-wrap items-center gap-1">
    {noteActions ? <>
      <button type="button" className={`${iconClass} aria-expanded:bg-accent-soft aria-expanded:text-accent-fg aria-expanded:hover:bg-accent-soft`} aria-expanded={noteActions.chatOpen ?? false} aria-controls={`note-assistant-${detail.note.id}`} disabled={noteActions.busy} onClick={noteActions.onChat}><MessageCircle className="size-4" aria-hidden />{zh ? '问这段录音' : 'Ask recording'}</button>
      <button type="button" className={iconClass} aria-label={zh ? '分享笔记' : 'Share note'} disabled={noteActions.busy} onClick={noteActions.onShare}><Share2 className="size-4" aria-hidden /><span className="hidden sm:inline">{zh ? '分享' : 'Share'}</span></button>
    </> : null}
    <DropdownMenu.Root><DropdownMenu.Trigger asChild><button type="button" className={iconClass} aria-label={zh ? '导出笔记' : 'Export note'}><Download className="size-4" aria-hidden /><span className="hidden sm:inline">{zh ? '导出' : 'Export'}</span></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} collisionPadding={12} className={menuClass}>
      {['md','txt','srt'].map(format => {
        const href = apiUrl(`${base}/export?format=${format}`);
        return <DropdownMenu.Item key={format} asChild><a className={rowClass} href={href} download onClick={event => {
          if (typeof URL.createObjectURL !== 'function') return;
          event.preventDefault();
          void triggerAuthenticatedDownload(href, `meeting.${format}`);
        }}>{format === 'srt' ? (zh ? '字幕 · SRT' : 'Subtitles · SRT') : format === 'md' ? 'Markdown · MD' : (zh ? '纯文本 · TXT' : 'Plain text · TXT')}</a></DropdownMenu.Item>;
      })}
      {audio ? <><DropdownMenu.Separator className="my-1 h-px bg-edge-subtle" /><DropdownMenu.Item asChild><a className={rowClass} href={apiUrl(`${base}/audio`)} download onClick={event => {
        if (typeof URL.createObjectURL !== 'function') return;
        event.preventDefault();
        const ext = detail.discussion.mimeType?.includes('wav') ? 'wav' : detail.discussion.mimeType?.includes('mp4') ? 'm4a' : 'webm';
        void triggerAuthenticatedDownload(apiUrl(`${base}/audio`), `recording.${ext}`);
      }}><Download className="size-4" aria-hidden />{zh ? '下载录音' : 'Download recording'}</a></DropdownMenu.Item></> : null}
    </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
    <DropdownMenu.Root><DropdownMenu.Trigger asChild><button type="button" data-note-actions-trigger aria-label={zh ? '更多笔记操作' : 'More note actions'} className={iconClass}><MoreHorizontal className="size-5" aria-hidden /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} collisionPadding={12} className={menuClass}>
      {noteActions ? <>
        <DropdownMenu.Item className={rowClass} disabled={noteActions.busy} onSelect={noteActions.onAnalyze}><Sparkles className="size-4" aria-hidden />{zh ? '进一步分析' : 'Analyze this note'}</DropdownMenu.Item>
        {noteActions.onOutline ? <DropdownMenu.Item className={rowClass} onSelect={noteActions.onOutline}><AlignLeft className="size-4" aria-hidden />{zh ? '文档大纲' : 'Document outline'}</DropdownMenu.Item> : null}
        <DropdownMenu.Item className={rowClass} onSelect={noteActions.onHistory}><History className="size-4" aria-hidden />{zh ? '版本历史' : 'Version history'}</DropdownMenu.Item>
      </> : null}
      <div><PageContextCaptureButton presentation="menu" resource={{ kind: 'note',id: detail.note.id,revision: String(detail.note.remoteVersion ?? 1) }} selection={{ text: pageText,draft: false }} label={zh ? '带到新对话' : 'Use in a new chat'} disabled={busy || processing || editing || !pageText || pageText.length > 16000} /></div>
      {noteActions ? <><DropdownMenu.Separator className="my-1 h-px bg-edge-subtle" /><DropdownMenu.Item className={`${rowClass} text-danger`} disabled={noteActions.busy} onSelect={noteActions.onDelete}><Trash2 className="size-4" aria-hidden />{zh ? '删除笔记' : 'Delete note'}</DropdownMenu.Item></> : null}
    </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
  </div>;
}

export function DiscussionOrganizeSettings({ detail, template, onTemplate, zh, busy, processing, onOrganize, onRegenerate, onDiarize }: {
  detail: DiscussionDetail; template: DiscussionTemplate; onTemplate: (value: DiscussionTemplate) => void;
  zh: boolean; busy: boolean; processing: boolean; onOrganize: () => void; onRegenerate: () => void; onDiarize?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [hotwordsDraft, setHotwordsDraft] = useState('');
  const [diarizationEnabled, setDiarizationEnabled] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);
  const audio = !!detail.discussion.audioAttachmentId && !detail.discussion.audioDeletedAt;

  useEffect(() => {
    if (!open) return;
    setPrefsSaved(false);
    void Promise.resolve(fetchJson<DiscussionCaptureSettings>(apiUrl('/api/discussion-capture/settings')))
      .then((settings) => {
        setHotwordsDraft((settings?.hotwords ?? []).join(', '));
        setDiarizationEnabled(settings?.diarizationEnabled !== false);
      })
      .catch(() => undefined);
  }, [open]);

  const saveVocabularyPrefs = async () => {
    setSavingPrefs(true);
    setPrefsSaved(false);
    try {
      await fetchJson<DiscussionCaptureSettings>(apiUrl('/api/discussion-capture/settings'), {
        method: 'PATCH',
        body: JSON.stringify({
          hotwords: hotwordsDraft,
          diarizationEnabled,
        }),
      });
      setPrefsSaved(true);
    } catch {
      /* ignore */
    } finally {
      setSavingPrefs(false);
    }
  };

  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs text-fg-muted hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"><SlidersHorizontal className="size-3.5" aria-hidden />{zh ? '整理方式' : 'Summary settings'}</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[150] bg-scrim" /><Dialog.Content className="fixed left-1/2 top-1/2 z-[151] flex h-[min(34rem,90dvh)] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay text-fg">
      <header className="flex shrink-0 items-center justify-between border-b border-edge-subtle px-5 py-3"><Dialog.Title className="font-medium">{zh ? '整理方式与语音偏好' : 'Summary & Speech Settings'}</Dialog.Title><Dialog.Close className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-surface-hover" aria-label={zh ? '关闭整理设置' : 'Close summary settings'}><X className="size-4" /></Dialog.Close></header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5"><Dialog.Description className="text-sm leading-6 text-fg-muted">{zh ? '根据已有原文（及你记录的个人提纲要点）重新整理纪要。已手动编辑的条目会保留。' : 'Reorganize the transcript and fuse your personal outline notes. Manual edits are preserved.'}</Dialog.Description>
        <label className="block space-y-2 text-sm"><span>{zh ? '纪要模板' : 'Summary template'}</span><Select value={template} aria-label={zh ? '纪要模板' : 'Summary template'} onChange={event => onTemplate(event.target.value as DiscussionTemplate)}><SelectOption value="general">{zh ? '通用会议' : 'General'}</SelectOption><SelectOption value="project">{zh ? '项目例会' : 'Project'}</SelectOption><SelectOption value="review">{zh ? '需求评审' : 'Review'}</SelectOption><SelectOption value="interview">{zh ? '客户访谈' : 'Interview'}</SelectOption></Select></label>

        <div className="space-y-3 border-t border-edge-subtle pt-4">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>{zh ? '自动区分说话人（转写与纪要归因）' : 'Automatic speaker diarization'}</span>
            <input
              type="checkbox"
              checked={diarizationEnabled}
              onChange={(event) => setDiarizationEnabled(event.target.checked)}
              className="accent-accent"
            />
          </label>
          {onDiarize ? (
            <div>
              <Button disabled={busy || processing} onClick={() => { setOpen(false); onDiarize(); }}>
                <Users className="size-4" aria-hidden />
                {zh ? '立即对当前逐字稿识别说话人' : 'Identify speakers now'}
              </Button>
            </div>
          ) : null}

          <label className="block space-y-1.5 text-xs text-fg-muted">
            <span className="font-medium text-fg">{zh ? '个人热词本（人名 / 术语 / 缩写，逗号分隔）' : 'Custom vocabulary / hotwords (comma-separated)'}</span>
            <textarea
              rows={2}
              value={hotwordsDraft}
              onChange={(event) => setHotwordsDraft(event.target.value)}
              placeholder={zh ? '例如：xopc, 妙记, 张三, SQLite WAL, Q4 OKR' : 'e.g. xopc, Alice, Q4 OKR'}
              className="w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-xs text-fg outline-none focus:border-accent"
            />
          </label>
          <div className="flex items-center gap-2">
            <Button disabled={savingPrefs} onClick={() => void saveVocabularyPrefs()}>
              {savingPrefs ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存热词与说话人偏好' : 'Save speech preferences')}
            </Button>
            {prefsSaved ? <span className="text-xs text-accent-fg">{zh ? '已保存' : 'Saved'}</span> : null}
          </div>
        </div>

        {audio && ['completed','needs_attention'].includes(detail.discussion.status) ? <details className="border-t border-edge-subtle pt-3"><summary className="min-h-11 cursor-pointer text-sm text-fg-muted">{zh ? '高级选项：重新识别录音' : 'Advanced: transcribe again'}</summary><p className="mb-3 text-xs leading-5 text-fg-muted">{zh ? '使用最新热词词典重新识别原音，可能耗时较长。适用于原文缺失或专有名词识别不准。' : 'Process the original recording again with your latest hotwords. This may take longer.'}</p><Button disabled={busy || processing} onClick={() => { setOpen(false); onRegenerate(); }}>{zh ? '从原音重新生成' : 'Regenerate from audio'}</Button></details> : null}
      </div><footer className="flex shrink-0 justify-end gap-2 border-t border-edge-subtle p-4"><Dialog.Close asChild><Button>{zh ? '取消' : 'Cancel'}</Button></Dialog.Close><Button variant="primary" disabled={busy || processing || !detail.discussion.canonicalTranscript} onClick={() => { setOpen(false); onOrganize(); }}><RefreshCw className="size-4" aria-hidden />{zh ? '重新整理纪要' : 'Regenerate summary'}</Button></footer>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
