import * as Dialog from '@radix-ui/react-dialog';
import { Check, Copy, ExternalLink, Loader2, RefreshCw, Share2, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import { extendShare, revokeShare } from '@/features/shares/shares-api';

import {
  createNoteShare,
  listNoteShares,
  refreshNoteShare,
  type Note,
  type NoteShareItem,
} from './notes-api';

const TTL_OPTIONS = [
  { value: '86400000', zh: '24 小时', en: '24 hours' },
  { value: '604800000', zh: '7 天', en: '7 days' },
  { value: '2592000000', zh: '30 天', en: '30 days' },
];

export function NoteShareDialog({ open, onOpenChange, note }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note: Note;
}) {
  const language = useLocaleStore((state) => state.language);
  const zh = language === 'zh';
  const t = zh ? COPY_ZH : COPY_EN;
  const { data, mutate } = useSWR(open ? ['note-shares', note.id] : null, () => listNoteShares(note.id));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [ttlMs, setTtlMs] = useState('86400000');
  const [maxViews, setMaxViews] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyShareId, setBusyShareId] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const referencedAttachments = useMemo(() => {
    const ids = new Set<string>();
    note.markdown.replace(/xopc-attachment:\/\/notes\/([^/]+)\/([^\s)]+)/gi, (_match, noteId: string, attachmentId: string) => {
      try {
        if (decodeURIComponent(noteId) === note.id) ids.add(decodeURIComponent(attachmentId));
      } catch { /* invalid references are rejected by the server */ }
      return _match;
    });
    return (note.attachments ?? []).filter((attachment) => ids.has(attachment.id));
  }, [note.attachments, note.id, note.markdown]);

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set(referencedAttachments.map((attachment) => attachment.id)));
    setCreatedUrl(null);
    setCopied(false);
    setError(null);
  }, [open, referencedAttachments]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const result = await createNoteShare(note.id, {
        expectedNoteVersion: note.updatedAt,
        attachmentIds: [...selectedIds],
        ttlMs: Number(ttlMs),
        maxViews: maxViews.trim() ? Number(maxViews) : null,
        description: description.trim() || undefined,
      });
      setCreatedUrl(result.payload.shareUrl);
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const actOnShare = async (share: NoteShareItem, action: 'refresh' | 'extend' | 'revoke') => {
    setBusyShareId(share.id);
    setError(null);
    try {
      if (action === 'refresh') {
        await refreshNoteShare(note.id, share.id, { expectedNoteVersion: note.updatedAt, attachmentIds: [...selectedIds] });
      } else if (action === 'extend') {
        await extendShare(share.id, 86_400_000);
      } else {
        await revokeShare(share.id);
      }
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyShareId(null);
    }
  };

  const copyUrl = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[71] flex h-[min(42rem,calc(100dvh-2rem))] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-popover outline-none">
          <div className="flex shrink-0 items-start justify-between border-b border-edge px-5 py-4">
            <div>
              <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-fg"><Share2 className="size-4" />{t.title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-fg-muted">{t.description}</Dialog.Description>
            </div>
            <Dialog.Close asChild><button type="button" className="rounded-md p-1.5 text-fg-muted hover:bg-surface-hover" aria-label={t.close}><X className="size-4" /></button></Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <section className="rounded-lg border border-edge-subtle bg-surface-subtle p-4">
              <div className="text-sm font-semibold text-fg">{note.title || t.untitled}</div>
              <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-fg-muted">{note.markdown || t.empty}</p>
              <p className="mt-3 text-xs text-fg-subtle">{t.privateExcluded}</p>
            </section>

            {referencedAttachments.length > 0 ? (
              <section className="mt-5">
                <h3 className="text-sm font-medium text-fg">{t.attachments}</h3>
                <div className="mt-2 grid gap-2">
                  {referencedAttachments.map((attachment) => {
                    const checked = selectedIds.has(attachment.id);
                    return (
                      <label key={attachment.id} className="flex items-center gap-3 rounded-lg border border-edge-subtle px-3 py-2 text-sm text-fg-muted">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setSelectedIds((current) => {
                            const next = new Set(current);
                            if (next.has(attachment.id)) next.delete(attachment.id); else next.add(attachment.id);
                            return next;
                          })}
                          className="accent-accent"
                        />
                        <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
                        <span className="text-xs text-fg-subtle">{formatBytes(attachment.size)}</span>
                      </label>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs text-fg-muted">
                {t.expires}
                <Select value={ttlMs} onChange={(event) => setTtlMs(event.target.value)}>
                  {TTL_OPTIONS.map((option) => <SelectOption key={option.value} value={option.value}>{zh ? option.zh : option.en}</SelectOption>)}
                </Select>
              </label>
              <label className="grid gap-1.5 text-xs text-fg-muted">
                {t.maxViews}
                <input type="number" min={1} max={1000} value={maxViews} onChange={(event) => setMaxViews(event.target.value)} placeholder={t.unlimited} className="h-9 rounded-md border border-edge bg-surface-panel px-3 text-sm text-fg outline-none focus:border-accent" />
              </label>
              <label className="grid gap-1.5 text-xs text-fg-muted sm:col-span-2">
                {t.publicDescription}
                <input value={description} onChange={(event) => setDescription(event.target.value)} className="h-9 rounded-md border border-edge bg-surface-panel px-3 text-sm text-fg outline-none focus:border-accent" />
              </label>
            </section>

            {createdUrl ? (
              <div className="mt-5 rounded-lg border border-success/25 bg-success-soft p-3">
                <div className="flex gap-2">
                  <input readOnly value={createdUrl} className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none" />
                  <Button type="button" className="px-2 py-1 text-xs" variant="ghost" onClick={() => void copyUrl(createdUrl)}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? t.copied : t.copy}</Button>
                  <Button type="button" className="px-2 py-1 text-xs" variant="ghost" onClick={() => window.open(createdUrl, '_blank', 'noopener,noreferrer')}><ExternalLink className="size-4" />{t.open}</Button>
                </div>
              </div>
            ) : null}

            {error ? <p className="mt-4 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}

            {(data?.items.length ?? 0) > 0 ? (
              <section className="mt-6 border-t border-edge pt-5">
                <h3 className="text-sm font-medium text-fg">{t.activeLinks}</h3>
                <div className="mt-2 grid gap-2">
                  {data!.items.map((share) => <ShareRow key={share.id} share={share} busy={busyShareId === share.id} t={t} onCopy={copyUrl} onAction={actOnShare} />)}
                </div>
              </section>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-edge px-5 py-3">
            <Dialog.Close asChild><Button type="button" variant="ghost">{t.close}</Button></Dialog.Close>
            <Button type="button" onClick={() => void handleCreate()} disabled={creating}>{creating ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />}{creating ? t.creating : t.create}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ShareRow({ share, busy, t, onCopy, onAction }: {
  share: NoteShareItem;
  busy: boolean;
  t: Copy;
  onCopy: (url: string) => Promise<void>;
  onAction: (share: NoteShareItem, action: 'refresh' | 'extend' | 'revoke') => Promise<void>;
}) {
  const inactive = share.revoked || share.expired;
  return (
    <div className={cn('rounded-lg border border-edge-subtle p-3', inactive && 'opacity-60')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <span>{share.stale && !inactive ? t.stale : inactive ? t.inactive : t.active}</span>
            <span>·</span><span>{t.views} {share.viewCount}{share.maxViews !== null ? ` / ${share.maxViews}` : ''}</span>
            <span>·</span><span>{new Date(share.expiresAt).toLocaleDateString()}</span>
          </div>
          <div className="mt-1 truncate text-xs text-fg-subtle">{share.shareUrl}</div>
        </div>
        {busy ? <Loader2 className="size-4 animate-spin text-fg-muted" /> : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => void onCopy(share.shareUrl)}><Copy className="size-3.5" />{t.copy}</Button>
        <Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => window.open(share.shareUrl, '_blank', 'noopener,noreferrer')}><ExternalLink className="size-3.5" />{t.open}</Button>
        {share.stale && !inactive ? <Button className="px-2 py-1 text-xs" variant="ghost" disabled={busy} onClick={() => void onAction(share, 'refresh')}><RefreshCw className="size-3.5" />{t.refresh}</Button> : null}
        {!inactive ? <Button className="px-2 py-1 text-xs" variant="ghost" disabled={busy} onClick={() => void onAction(share, 'extend')}>{t.extend}</Button> : null}
        {!share.revoked ? <Button className="px-2 py-1 text-xs" variant="ghost" disabled={busy} onClick={() => void onAction(share, 'revoke')}><Trash2 className="size-3.5" />{t.revoke}</Button> : null}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

const COPY_ZH = {
  title: '分享笔记', description: '创建一个无需登录即可查看的只读快照。', close: '关闭', untitled: '无标题笔记', empty: '空笔记',
  privateExcluded: '不会分享标签、AI 元数据、项目、讨论、历史版本或未引用附件。', attachments: '包含的附件', expires: '有效期', maxViews: '最多查看次数', unlimited: '不限',
  publicDescription: '公开说明（可选）', create: '创建分享链接', creating: '创建中…', copy: '复制', copied: '已复制', open: '打开', activeLinks: '这条笔记的分享',
  stale: '旧版本', inactive: '已失效', active: '有效', views: '查看', refresh: '更新快照', extend: '延长 24 小时', revoke: '撤销',
} as const;

type Copy = { [K in keyof typeof COPY_ZH]: string };

const COPY_EN: Copy = {
  title: 'Share Note', description: 'Create a read-only snapshot that opens without sign-in.', close: 'Close', untitled: 'Untitled Note', empty: 'Empty Note',
  privateExcluded: 'Tags, AI metadata, projects, discussions, history, and unreferenced attachments are excluded.', attachments: 'Included attachments', expires: 'Expires', maxViews: 'Maximum views', unlimited: 'Unlimited',
  publicDescription: 'Public description (optional)', create: 'Create share link', creating: 'Creating…', copy: 'Copy', copied: 'Copied', open: 'Open', activeLinks: 'Shares for this Note',
  stale: 'Older version', inactive: 'Inactive', active: 'Active', views: 'Views', refresh: 'Update snapshot', extend: 'Extend 24 hours', revoke: 'Revoke',
};
