import * as Dialog from '@radix-ui/react-dialog';
import { ExternalLink, Loader2, MessageSquareShare, RefreshCw, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import {
  createSessionShare,
  fetchSessionSharePreview,
  fetchSessionShares,
  refreshSessionShare,
  revokeShare,
  type SessionSharePreview,
  type SessionShareResult,
} from '@/features/shares/shares-api';
import { ReachabilityHint, ShareUrlCopyRows } from '@/features/shares/share-link-dialog';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

export function SessionShareButton({ sessionKey }: { sessionKey: string }) {
  const language = useLocaleStore((state) => state.language);
  const t = language === 'zh' ? LABELS_ZH : LABELS_EN;
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<SessionSharePreview | null>(null);
  const [result, setResult] = useState<SessionShareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ttlMs, setTtlMs] = useState(86_400_000);
  const [maxViews, setMaxViews] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [includeToolActivities, setIncludeToolActivities] = useState(false);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open || preview || result) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([fetchSessionSharePreview(sessionKey), fetchSessionShares(sessionKey)])
      .then(([value, shares]) => {
        if (cancelled) return;
        setPreview(value);
        const active = shares.find((share) => !share.revoked && !share.expired);
        if (active) setResult(active);
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, preview, result, sessionKey]);

  const reset = () => {
    setPreview(null);
    setResult(null);
    setError(null);
    setLoading(false);
    setDescription('');
    setIncludeToolActivities(false);
    setAttachmentIds([]);
  };

  const create = async () => {
    if (!preview || loading) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await createSessionShare(sessionKey, {
        expectedSessionId: preview.sessionId,
        expectedCutoffSeq: preview.cutoffSeq,
        expectedMetadataUpdatedAt: preview.metadataUpdatedAt,
        ttlMs,
        maxViews,
        description: description.trim() || undefined,
        includeToolActivities,
        attachmentIds,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    if (!result || loading) return;
    setLoading(true);
    setError(null);
    try {
      const latest = await fetchSessionSharePreview(sessionKey);
      setPreview(latest);
      setResult(await refreshSessionShare(sessionKey, result.id, {
        expectedSessionId: latest.sessionId,
        expectedCutoffSeq: latest.cutoffSeq,
        expectedMetadataUpdatedAt: latest.metadataUpdatedAt,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const revoke = async () => {
    if (!result || loading) return;
    setLoading(true);
    setError(null);
    try {
      await revokeShare(result.id);
      setOpen(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="rounded-md p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          title={t.share}
          aria-label={t.share}
        >
          <MessageSquareShare className="size-4" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[71] flex h-[min(35rem,calc(100dvh-2rem))] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col',
            'overflow-hidden rounded-lg border border-edge bg-surface-panel shadow-popover outline-none',
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge px-4 py-3">
            <div>
              <Dialog.Title className="text-base font-semibold text-fg">{result ? t.created : t.title}</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-fg-muted">{result ? t.createdHint : t.hint}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="rounded-md p-2 text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={t.close}>
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {loading && !preview && !result ? (
              <div className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="size-4 animate-spin" />{t.loading}</div>
            ) : result ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-fg">{result.fileName}</p>
                  <p className="mt-1 text-xs text-fg-muted">{t.snapshotMessages.replace('{{count}}', String(result.messageCount))}</p>
                  <p className="mt-1 text-xs text-fg-subtle">{t.revision.replace('{{revision}}', String(result.snapshotRevision))} · {t.sharedAttachments.replace('{{count}}', String(result.attachmentCount))}</p>
                </div>
                <ShareUrlCopyRows shareUrl={result.shareUrl} lanUrl={result.lanUrl} reachability={result.reachability} />
                <ReachabilityHint reachability={result.reachability} reachabilityHint={result.reachabilityHint} />
                <a href={result.shareUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                  {t.open}<ExternalLink className="size-3.5" />
                </a>
              </div>
            ) : preview ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-edge-subtle bg-surface-muted/45 px-3 py-3">
                  <p className="truncate text-sm font-medium text-fg">{preview.title}</p>
                  <p className="mt-1 text-xs text-fg-muted">{t.snapshotMessages.replace('{{count}}', String(preview.messageCount))}</p>
                  <p className="mt-1 text-xs text-fg-subtle">{new Date(preview.snapshotAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}</p>
                </div>
                <div className="rounded-lg bg-surface-subtle px-3 py-2 text-xs leading-5 text-fg-muted">{t.scope}</div>
                {preview.toolActivities.length ? (
                  <label className="flex items-start gap-2 rounded-lg border border-edge-subtle px-3 py-2.5 text-sm text-fg">
                    <input type="checkbox" checked={includeToolActivities} disabled={loading} onChange={(event) => setIncludeToolActivities(event.target.checked)} className="mt-0.5 size-4 rounded border-edge" />
                    <span>
                      <span className="block font-medium">{t.includeTools.replace('{{count}}', String(preview.toolActivities.length))}</span>
                      <span className="mt-0.5 block text-xs text-fg-muted">{t.toolDisclosure}</span>
                    </span>
                  </label>
                ) : null}
                {preview.attachmentCandidates.length ? (
                  <fieldset className="rounded-lg border border-edge-subtle px-3 py-2.5">
                    <legend className="px-1 text-xs font-medium text-fg">{t.attachments}</legend>
                    <p className="mb-2 text-xs text-fg-muted">{t.attachmentDisclosure}</p>
                    <div className="space-y-2">
                      {preview.attachmentCandidates.map((attachment) => (
                        <label key={attachment.id} className="flex items-center gap-2 text-sm text-fg">
                          <input
                            type="checkbox"
                            checked={attachmentIds.includes(attachment.id)}
                            disabled={loading}
                            onChange={(event) => setAttachmentIds((current) => event.target.checked
                              ? [...current, attachment.id]
                              : current.filter((id) => id !== attachment.id))}
                            className="size-4 rounded border-edge"
                          />
                          <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
                          <span className="shrink-0 text-xs text-fg-subtle">{formatBytes(attachment.size)}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 text-xs font-medium text-fg">
                    <span>{t.ttl}</span>
                    <Select value={ttlMs} disabled={loading} onChange={(event) => setTtlMs(Number(event.target.value))}>
                      <SelectOption value={3_600_000}>{t.oneHour}</SelectOption>
                      <SelectOption value={86_400_000}>{t.oneDay}</SelectOption>
                      <SelectOption value={604_800_000}>{t.sevenDays}</SelectOption>
                      <SelectOption value={2_592_000_000}>{t.thirtyDays}</SelectOption>
                    </Select>
                  </label>
                  <label className="space-y-1.5 text-xs font-medium text-fg">
                    <span>{t.maxViews}</span>
                    <Select value={maxViews ?? 'unlimited'} disabled={loading} onChange={(event) => setMaxViews(event.target.value === 'unlimited' ? null : Number(event.target.value))}>
                      <SelectOption value="unlimited">{t.unlimited}</SelectOption>
                      <SelectOption value={1}>1</SelectOption>
                      <SelectOption value={10}>10</SelectOption>
                      <SelectOption value={50}>50</SelectOption>
                    </Select>
                  </label>
                </div>
                <label className="block space-y-1.5 text-xs font-medium text-fg">
                  <span>{t.description}</span>
                  <input value={description} disabled={loading} onChange={(event) => setDescription(event.target.value)} className="h-10 w-full rounded-lg border border-edge bg-surface-subtle px-3 text-sm font-normal text-fg outline-none focus:border-edge-strong" />
                </label>
                <p className="text-xs text-amber-700 dark:text-amber-300">{t.publicWarning}</p>
              </div>
            ) : null}
            {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-edge px-4 py-3">
            {result ? (
              <>
                <Button type="button" variant="ghost" disabled={loading} onClick={() => setResult(null)}>{t.newShare}</Button>
                <Button type="button" variant="ghost" disabled={loading} onClick={() => void revoke()}>
                  <Trash2 className="size-4" />{t.revoke}
                </Button>
                <Button type="button" disabled={loading} onClick={() => void refresh()}>
                  {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{t.refresh}
                </Button>
              </>
            ) : (
              <>
                <Dialog.Close asChild><Button type="button" variant="ghost">{t.cancel}</Button></Dialog.Close>
                <Button type="button" disabled={!preview || loading || preview.messageCount === 0} onClick={() => void create()}>
                  {loading ? <Loader2 className="size-4 animate-spin" /> : null}{t.create}
                </Button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const LABELS_ZH = {
  share: '分享会话', title: '分享会话', hint: '创建当前会话的只读快照', created: '分享已创建', createdHint: '复制链接后即可发送给其他人',
  close: '关闭', loading: '正在准备预览…', snapshotMessages: '当前快照包含 {{count}} 条公开消息',
  scope: '默认仅包含用户与助手的可见文本；系统提示、推理、工具参数、命令文本、输出和路径始终不会公开。', ttl: '有效期', maxViews: '最大访问次数',
  includeTools: '包含 {{count}} 条工具活动', toolDisclosure: '只公开工具名称和成功/失败状态，不公开参数与结果。', attachments: '附件', attachmentDisclosure: '附件默认不公开，请逐个选择。',
  oneHour: '1 小时', oneDay: '24 小时', sevenDays: '7 天', thirtyDays: '30 天', unlimited: '不限', description: '说明（可选）',
  publicWarning: '任何获得链接的人都可以查看这份快照。后续会话消息不会自动加入。', cancel: '取消', create: '创建分享', revoke: '撤销分享', refresh: '更新到当前会话', open: '打开分享页面',
  revision: '快照版本 {{revision}}', sharedAttachments: '{{count}} 个附件', newShare: '新建分享',
};

const LABELS_EN = {
  share: 'Share conversation', title: 'Share conversation', hint: 'Create a read-only snapshot of this conversation', created: 'Share created', createdHint: 'Copy the link and send it to anyone',
  close: 'Close', loading: 'Preparing preview…', snapshotMessages: 'This snapshot contains {{count}} public messages',
  scope: 'Only visible user and assistant text is included by default. System prompts, reasoning, tool arguments, command text, output, and paths always stay private.', ttl: 'Expires after', maxViews: 'Maximum views',
  includeTools: 'Include {{count}} tool activities', toolDisclosure: 'Only tool names and success/failure states are shared; arguments and results stay private.', attachments: 'Attachments', attachmentDisclosure: 'Attachments stay private unless selected individually.',
  oneHour: '1 hour', oneDay: '24 hours', sevenDays: '7 days', thirtyDays: '30 days', unlimited: 'Unlimited', description: 'Description (optional)',
  publicWarning: 'Anyone with the link can view this snapshot. Later conversation messages are not added automatically.', cancel: 'Cancel', create: 'Create share', revoke: 'Revoke share', refresh: 'Update to current conversation', open: 'Open shared page',
  revision: 'Snapshot revision {{revision}}', sharedAttachments: '{{count}} attachments', newShare: 'New share',
};
