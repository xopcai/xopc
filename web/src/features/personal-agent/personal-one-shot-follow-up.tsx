import * as Dialog from '@radix-ui/react-dialog';
import {
  PersonalOneShotFollowUpDtoSchema,
  StopPersonalOneShotFollowUpResponseSchema,
  type PersonalOneShotFollowUpDto,
  type StopPersonalOneShotFollowUpResponse,
} from '@xopcai/gateway-contract';
import { Bell, ChevronRight, ExternalLink, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AssistantCapsuleContent, assistantCapsuleClassName } from '@/features/chat/messages/assistant-capsule';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

type ApiEnvelope<T = unknown> = { ok: boolean; payload?: T; error?: string };

export async function fetchOneShotFollowUp(followUpId: string): Promise<PersonalOneShotFollowUpDto> {
  const response = await fetchJson<ApiEnvelope>(apiUrl(`/api/personal-agent/attention/${encodeURIComponent(followUpId)}`));
  if (!response.ok || !response.payload) {
    throw new Error(response.error ?? 'Follow-up is unavailable');
  }
  return PersonalOneShotFollowUpDtoSchema.parse(response.payload);
}

export async function stopOneShotFollowUpApi(
  followUpId: string,
  expectedRevision?: number,
): Promise<StopPersonalOneShotFollowUpResponse> {
  const response = await fetchJson<ApiEnvelope>(apiUrl(`/api/personal-agent/attention/${encodeURIComponent(followUpId)}/stop`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
      idempotencyKey: crypto.randomUUID(),
    }),
  });
  if (!response.ok || !response.payload) {
    throw new Error(response.error ?? 'Failed to stop follow-up');
  }
  return StopPersonalOneShotFollowUpResponseSchema.parse(response.payload);
}

export async function acknowledgeWorkbenchFollowUpApi(outreachId: string): Promise<void> {
  await fetchJson(apiUrl('/api/home/attention/acknowledge'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'one_shot_follow_up',
      outreachId,
    }),
  });
}

export function formatOneShotFollowUpStatus(
  dto: Pick<PersonalOneShotFollowUpDto, 'displayState' | 'terminalReason'> | undefined,
  zh: boolean,
): string {
  if (!dto) return zh ? '查看跟进' : 'View follow-up';
  if (dto.terminalReason === 'conversation_reset') {
    return zh ? '关联对话已重置 · 跟进结束' : 'Conversation reset · Ended';
  }
  if (dto.terminalReason === 'access_revoked') {
    return zh ? '权限已变更 · 跟进结束' : 'Access revoked · Ended';
  }
  switch (dto.displayState) {
    case 'scheduled':
      return zh ? '等待检查' : 'Scheduled';
    case 'queued_delivery':
      return zh ? '等待送达' : 'Waiting to deliver';
    case 'delivered':
      return zh ? '已提醒 · 跟进结束' : 'Reminded · Ended';
    case 'resolved_before_check':
      return zh ? '事项已处理 · 跟进结束' : 'Resolved · Ended';
    case 'stopped':
      return zh ? '已停止' : 'Stopped';
    case 'expired':
      return zh ? '已到期 · 跟进结束' : 'Expired · Ended';
    default:
      return zh ? '跟进已结束' : 'Follow-up ended';
  }
}

function formatFollowUpTime(ms: number, timezone: string, zh: boolean): string {
  try {
    return new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-US', {
      timeZone: timezone,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(ms);
  } catch {
    return new Date(ms).toLocaleString(zh ? 'zh-CN' : 'en-US');
  }
}

export function useOneShotFollowUp(followUpId: string | null) {
  const token = useGatewayStore(state => state.conversationId);
  const swr = useSWR(
    followUpId && token ? ['personal-one-shot-follow-up', followUpId, token] : null,
    () => fetchOneShotFollowUp(followUpId!),
    { revalidateOnFocus: true },
  );

  useEffect(() => {
    if (!followUpId) return;
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ followUpId?: string }>).detail;
      if (!detail?.followUpId || detail.followUpId === followUpId) {
        void swr.mutate();
      }
    };
    window.addEventListener('personal-follow-up-updated', onUpdated);
    return () => window.removeEventListener('personal-follow-up-updated', onUpdated);
  }, [followUpId, swr.mutate]);

  return swr;
}

export function PersonalOneShotFollowUpDialog({
  followUpId,
  open,
  onOpenChange,
  onChanged,
}: {
  followUpId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: (followUp: PersonalOneShotFollowUpDto) => void;
}) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const { data: detail, error: loadError, mutate } = useOneShotFollowUp(open ? followUpId : null);
  const [busy, setBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setActionNotice(null);
      setActionError(null);
    }
  }, [open]);

  const handleStop = useCallback(async () => {
    if (!detail || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await stopOneShotFollowUpApi(detail.followUpId, detail.revision);
      await mutate(result.followUp, false);
      onChanged?.(result.followUp);
      if (result.outcome === 'already_delivered') {
        setActionNotice(zh ? '已提醒，跟进已结束。' : 'Already reminded; follow-up has ended.');
      } else if (result.outcome === 'stopped') {
        setActionNotice(zh ? '已停止这次跟进。' : 'Follow-up stopped.');
      } else {
        setActionNotice(formatOneShotFollowUpStatus(result.followUp, zh));
      }
    } catch (cause) {
      void mutate();
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [busy, detail, mutate, onChanged, zh]);

  const active = detail?.status === 'active';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-70 bg-black/35" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-80 flex h-[min(30rem,78dvh)] flex-col overflow-hidden rounded-t-2xl border border-edge bg-surface-overlay sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(28rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl">
          <div className="flex shrink-0 items-center justify-between border-b border-edge px-5 py-4">
            <Dialog.Title className="text-sm font-semibold text-fg">
              {zh ? '条件跟进详情' : 'Follow-up details'}
            </Dialog.Title>
            <Dialog.Close
              className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={zh ? '关闭' : 'Close'}
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            {zh ? '查看本次条件跟进的来源、检查时间、送达位置与状态，或停止跟进。' : 'Inspect the source, schedule, destination, and status of this follow-up, or stop it.'}
          </Dialog.Description>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
            {!detail && !loadError && (
              <div className="space-y-3" aria-busy>
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            )}
            {loadError && !detail && (
              <div role="alert" className="space-y-2 text-fg-muted">
                <p className="text-danger">{zh ? '暂时无法读取跟进状态。' : 'Unable to load follow-up details.'}</p>
                <Button type="button" variant="secondary" onClick={() => void mutate()}>
                  {zh ? '重试' : 'Retry'}
                </Button>
              </div>
            )}
            {detail && (
              <>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-edge bg-surface-panel px-3 py-2.5">
                  <span className="text-xs text-fg-muted">{zh ? '当前状态' : 'Status'}</span>
                  <span className="text-xs font-medium text-fg">{formatOneShotFollowUpStatus(detail, zh)}</span>
                </div>

                {actionNotice && (
                  <p role="status" className="rounded-lg border border-edge bg-surface-inset px-3 py-2 text-xs text-fg">
                    {actionNotice}
                  </p>
                )}

                <div>
                  <p className="mb-1 text-xs font-medium text-fg-muted">{zh ? '关联事项' : 'Source task'}</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium text-fg">
                      {detail.taskTitle || detail.subject || (zh ? '原事项权限已变更' : 'Task details unavailable')}
                    </span>
                    <Link
                      to={`/tasks/${encodeURIComponent(detail.taskId)}`}
                      onClick={() => onOpenChange(false)}
                      className="inline-flex shrink-0 items-center gap-1 text-xs text-accent hover:underline"
                    >
                      {zh ? '查看原事项' : 'Open task'}
                      <ExternalLink className="size-3.5" aria-hidden />
                    </Link>
                  </div>
                  {detail.projectName && (
                    <p className="mt-0.5 text-xs text-fg-muted">{detail.projectName}</p>
                  )}
                </div>

                {(detail.waitSummary || detail.summary) && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-fg-muted">{zh ? '触发条件' : 'Condition'}</p>
                    <p className="text-fg-muted">
                      {zh ? '到检查时点仍待处理：' : 'Still pending at check time: '}
                      {detail.waitSummary || detail.summary}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 rounded-lg border border-edge p-3 text-xs">
                  <div>
                    <p className="text-fg-muted">{zh ? '检查时间' : 'Check time'}</p>
                    <p className="mt-0.5 font-medium text-fg">{formatFollowUpTime(detail.checkAt, detail.timezone, zh)}</p>
                  </div>
                  <div>
                    <p className="text-fg-muted">{zh ? '有效期至' : 'Valid until'}</p>
                    <p className="mt-0.5 font-medium text-fg">{formatFollowUpTime(detail.validUntil, detail.timezone, zh)}</p>
                  </div>
                  <div>
                    <p className="text-fg-muted">{zh ? '提醒位置' : 'Destination'}</p>
                    <p className="mt-0.5 font-medium text-fg">
                      {detail.destination === 'workbench'
                        ? (zh ? '工作台原事项' : 'Workbench task')
                        : (zh ? 'Personal 对话' : 'Personal chat')}
                    </p>
                  </div>
                  <div>
                    <p className="text-fg-muted">{zh ? '最近检查' : 'Last checked'}</p>
                    <p className="mt-0.5 font-medium text-fg">
                      {detail.lastCheckedAt !== null
                        ? formatFollowUpTime(detail.lastCheckedAt, detail.timezone, zh)
                        : (zh ? '尚未到点' : 'Not yet')}
                    </p>
                  </div>
                </div>

                {detail.sourcesAvailable && detail.sources.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-fg-muted">{zh ? '委托依据' : 'Requested in chat'}</p>
                    {detail.sources.slice(0, 2).map(source => (
                      <a
                        key={source.entryId}
                        href={`#/chat/${encodeURIComponent(source.conversationId)}?entryId=${encodeURIComponent(source.entryId)}`}
                        onClick={() => onOpenChange(false)}
                        className="block rounded-lg border border-edge p-2.5 text-xs text-fg-muted hover:border-accent/40 hover:text-fg"
                      >
                        <span className="line-clamp-2">{source.excerpt}</span>
                      </a>
                    ))}
                  </div>
                )}

                {actionError && (
                  <p role="alert" className="text-xs text-danger">{actionError}</p>
                )}
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-edge px-5 py-3">
            {active ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void handleStop()}
              >
                {busy ? (zh ? '正在停止' : 'Stopping') : (zh ? '停止跟进' : 'Stop follow-up')}
              </Button>
            ) : (
              <span className="text-xs text-fg-muted">
                {detail ? formatOneShotFollowUpStatus(detail, zh) : ''}
              </span>
            )}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {zh ? '关闭' : 'Close'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function PersonalFollowUpReceiptCapsule({
  followUpId,
  fallbackTitle,
  fallbackStatus,
}: {
  followUpId: string;
  fallbackTitle: string;
  fallbackStatus?: string;
}) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const [open, setOpen] = useState(false);
  const { data: detail } = useOneShotFollowUp(followUpId);
  const statusLabel = detail
    ? formatOneShotFollowUpStatus(detail, zh)
    : fallbackStatus === 'stopped'
      ? (zh ? '已停止' : 'Stopped')
      : (zh ? '查看跟进' : 'View follow-up');
  const title = detail?.taskTitle || detail?.subject || fallbackTitle;

  return (
    <li className="flex max-w-full min-w-0 items-center" data-product-delivery="personal_follow_up">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${assistantCapsuleClassName} cursor-pointer`}
        aria-label={zh ? `查看跟进：${title}` : `View follow-up: ${title}`}
      >
        <AssistantCapsuleContent
          icon={<Bell strokeWidth={1.75} />}
          title={zh ? `查看跟进 · ${title}` : `Follow-up · ${title}`}
          meta={statusLabel}
          trailing={<ChevronRight className="size-3.5 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden />}
        />
      </button>
      <PersonalOneShotFollowUpDialog
        followUpId={followUpId}
        open={open}
        onOpenChange={setOpen}
      />
    </li>
  );
}
