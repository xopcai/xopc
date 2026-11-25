import { AlertTriangle, Bell, Compass, Eye, Inbox, Pause, Play, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { PersonalOneShotFollowUpDto } from '@xopcai/gateway-contract';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';
import { PersonalMatterDialog } from './personal-matter-dialog';
import { formatOneShotFollowUpStatus, PersonalOneShotFollowUpDialog } from './personal-one-shot-follow-up';
import { formatPersonalScheduleTime } from './personal-task-time';

export type PersonalMatterBinding =
  | { kind: 'web_url'; watchId: string; url: string; label: string }
  | { kind: 'event_source'; subscriptionId: string; sourcePattern: string; eventTypePattern: string; label: string; keyword?: string; sender?: string }
  | { kind: 'web_search'; query: string; label: string }
  | { kind: 'task'; taskId: string; label?: string }
  | { kind: 'project'; projectId: string; label?: string };

export interface PersonalMatterProgressEntry {
  id: string;
  at: number;
  kind: 'created' | 'check_silent' | 'update_sent' | 'action_proposed' | 'resolved' | 'blocked' | 'user_note' | 'state_changed';
  summary: string;
  evidenceRefs?: string[];
  preparedDraft?: string;
  inboxItemId?: string;
  nextCheckAt?: number | null;
}

export interface PersonalMatterItem {
  id: string;
  title: string;
  goal: string;
  notifyWhen: string;
  doneCriteria?: string;
  status: 'active' | 'waiting_user' | 'paused' | 'resolved' | 'expired';
  deliveryPreference: 'auto' | 'chat' | 'inbox';
  deadlineAt: number | null;
  checkIntervalMs: number;
  nextCheckAt: number | null;
  lastCheckedAt: number | null;
  lastSummary: string;
  lastError: string | null;
  bindings: PersonalMatterBinding[];
  progressLog: PersonalMatterProgressEntry[];
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface PersonalRecurringFollowingItem {
  id: string;
  subject: string;
  summary: string;
  status: 'active' | 'paused';
  authority: 'user_explicit' | 'inferred';
  taskId: string | null;
  projectId: string | null;
  nextCheckAt: number | null;
  lastCheckedAt: number | null;
  lastMeaningfulAt: number;
  expiresAt: number;
  revision: number;
}

export interface PersonalFollowingSnapshot {
  matters: PersonalMatterItem[];
  oneShot: PersonalOneShotFollowUpDto[];
  recurring: PersonalRecurringFollowingItem[];
  waitingMatterCount: number;
  inboxPendingCount: number;
  digestBufferedCount: number;
  activeCount: number;
}

const FOLLOWING_PATH = '/api/personal-agent/following';

async function fetchPersonalFollowing([url]: readonly [string, string | undefined]) {
  return (await fetchJson<{ payload: PersonalFollowingSnapshot }>(url)).payload;
}

export function usePersonalFollowing(enabled: boolean) {
  const identity = useGatewayStore(state => state.conversationId);
  const swr = useSWR(
    enabled ? [apiUrl(FOLLOWING_PATH), identity] as const : null,
    fetchPersonalFollowing,
    { refreshInterval: 20_000 },
  );

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      void swr.mutate();
    };
    const events = [
      'personal-follow-up-updated',
      'proactive-inbox-updated',
      'proactive-item-resolved',
      'gateway-realtime-connected',
    ];
    events.forEach(event => window.addEventListener(event, refresh));
    return () => {
      events.forEach(event => window.removeEventListener(event, refresh));
    };
  }, [enabled, swr.mutate]);

  return swr;
}

export function PersonalFollowingSection({
  scope,
  visible,
  zh,
  onNavigate,
}: {
  scope: string;
  visible: boolean;
  zh: boolean;
  onNavigate?: () => void;
}) {
  const { data, error, mutate } = usePersonalFollowing(visible && scope !== 'new');
  const [openOneShotId, setOpenOneShotId] = useState<string | null>(null);
  const [openMatter, setOpenMatter] = useState<PersonalMatterItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const matters = Array.isArray(data?.matters) ? data.matters : [];
  const oneShot = Array.isArray(data?.oneShot) ? data.oneShot : [];
  const recurring = Array.isArray(data?.recurring) ? data.recurring : [];
  const inboxPendingCount = typeof data?.inboxPendingCount === 'number' ? data.inboxPendingCount : 0;

  const hasItems = matters.length > 0 || oneShot.length > 0 || recurring.length > 0 || inboxPendingCount > 0;
  if (!data && !error && visible) {
    return (
      <section className="space-y-1.5 px-2" aria-busy>
        <Skeleton className="h-3.5 w-24 rounded-md" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </section>
    );
  }
  if (!hasItems && !error) return null;

  const updateRecurring = async (item: PersonalRecurringFollowingItem, status: 'active' | 'paused' | 'completed') => {
    setBusyId(item.id);
    try {
      await fetchJson(apiUrl(`/api/personal-agent/attention/${encodeURIComponent(item.id)}`), {
        method: 'PATCH',
        body: JSON.stringify({ revision: item.revision, status }),
      });
      await mutate();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-1" aria-label={zh ? '正在替你跟进' : 'Following for you'}>
      <div className="flex items-center justify-between gap-2 px-2">
        <h3 className="text-xs font-semibold text-fg-muted">
          {zh ? '正在替你跟进' : 'Following for you'}
        </h3>
        {typeof data?.activeCount === 'number' && data.activeCount > 0 ? (
          <span className="text-xs tabular-nums text-fg-subtle">{data.activeCount}</span>
        ) : null}
      </div>

      {error ? (
        <button type="button" onClick={() => void mutate()} className="px-2 py-1 text-xs text-accent-fg underline">
          {zh ? '加载失败，重试' : 'Loading failed. Try again'}
        </button>
      ) : null}

      <ul className="space-y-0.5">
        {inboxPendingCount > 0 ? (
          <li>
            <Link
              to="/"
              onClick={onNavigate}
              className="flex min-w-0 items-start gap-2.5 rounded-xl bg-surface-hover/70 px-2 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center text-accent-fg" aria-hidden>
                <Inbox className="size-4" strokeWidth={1.7} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm leading-5 font-medium text-fg">
                  {zh ? `${inboxPendingCount} 项主动动态待你确认` : `${inboxPendingCount} proactive updates to review`}
                </span>
                <span className="block truncate text-xs leading-5 text-fg-muted">
                  {zh ? '前往工作台查看预备草稿与依据' : 'Open workbench to review drafts & evidence'}
                </span>
              </span>
            </Link>
          </li>
        ) : null}

        {matters.map(matter => {
          const dotTone = matter.lastError
            ? 'bg-warning'
            : matter.status === 'waiting_user'
              ? 'bg-warning'
              : matter.status === 'paused'
                ? 'bg-fg-subtle'
                : 'bg-accent';
          return (
            <li key={matter.id}>
              <button
                type="button"
                onClick={() => setOpenMatter(matter)}
                className="flex w-full min-w-0 items-start gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              >
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center text-fg-muted" aria-hidden>
                  {matter.lastError
                    ? <AlertTriangle className="size-4 text-warning" strokeWidth={1.7} />
                    : <Compass className="size-4" strokeWidth={1.7} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm leading-5 font-medium text-fg" title={matter.title}>
                    {matter.title}
                  </span>
                  <span className="block truncate text-xs leading-5 text-fg-muted" title={matter.lastSummary}>
                    {matter.lastSummary}
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] leading-4 text-fg-subtle">
                    <span className={cn('size-1.5 shrink-0 rounded-full', dotTone)} aria-hidden />
                    <span className="truncate">
                      {matter.status === 'waiting_user'
                        ? (zh ? '待你拍板' : 'Needs decision')
                        : matter.status === 'paused'
                          ? (zh ? '已暂停' : 'Paused')
                          : matter.nextCheckAt
                            ? (zh ? `下次检查 ${formatPersonalScheduleTime(matter.nextCheckAt, zh)}` : `Next ${formatPersonalScheduleTime(matter.nextCheckAt, zh)}`)
                            : (zh ? '持续跟进中' : 'Following')}
                    </span>
                    {matter.bindings.length > 0 ? (
                      <>
                        <span aria-hidden>·</span>
                        <span className="shrink-0">
                          {zh ? `${matter.bindings.length} 个来源` : `${matter.bindings.length} sources`}
                        </span>
                      </>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          );
        })}

        {oneShot.map(item => (
          <li key={item.followUpId}>
            <button
              type="button"
              onClick={() => setOpenOneShotId(item.followUpId)}
              className="flex w-full min-w-0 items-start gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center text-fg-muted" aria-hidden>
                <Bell className="size-4" strokeWidth={1.7} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm leading-5 font-medium text-fg" title={item.taskTitle || item.subject}>
                  {item.taskTitle || item.subject}
                </span>
                <span className="flex items-center gap-1.5 text-xs leading-5 text-fg-muted">
                  <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                  <span className="truncate">{formatOneShotFollowUpStatus(item, zh)}</span>
                  <span aria-hidden>·</span>
                  <span className="shrink-0 text-fg-subtle">{formatPersonalScheduleTime(item.checkAt, zh)}</span>
                </span>
              </span>
            </button>
          </li>
        ))}

        {recurring.map(item => (
          <li key={item.id} className="flex min-w-0 items-start gap-1 rounded-xl px-2 py-2 transition-colors hover:bg-surface-hover">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center text-fg-muted" aria-hidden>
              <Eye className="size-4" strokeWidth={1.7} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm leading-5 font-medium text-fg" title={item.subject}>
                {item.subject}
              </p>
              <p className="flex items-center gap-1.5 text-xs leading-5 text-fg-muted">
                <span className={cn('size-1.5 shrink-0 rounded-full', item.status === 'active' ? 'bg-accent' : 'bg-fg-subtle')} aria-hidden />
                <span className="truncate">
                  {item.status === 'paused'
                    ? (zh ? '已暂停' : 'Paused')
                    : item.nextCheckAt
                      ? (zh ? `下次检查 ${formatPersonalScheduleTime(item.nextCheckAt, zh)}` : `Next ${formatPersonalScheduleTime(item.nextCheckAt, zh)}`)
                      : (zh ? '持续留意中' : 'Watching')}
                </span>
                {item.lastCheckedAt ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="shrink-0 text-fg-subtle">
                      {zh ? `上次 ${formatPersonalScheduleTime(item.lastCheckedAt, zh)}` : `Checked ${formatPersonalScheduleTime(item.lastCheckedAt, zh)}`}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                disabled={busyId === item.id}
                onClick={() => void updateRecurring(item, item.status === 'active' ? 'paused' : 'active')}
                title={item.status === 'active' ? (zh ? '暂停跟进' : 'Pause') : (zh ? '恢复跟进' : 'Resume')}
                aria-label={item.status === 'active' ? (zh ? '暂停跟进' : 'Pause') : (zh ? '恢复跟进' : 'Resume')}
                className="grid size-7 place-items-center rounded-lg text-fg-muted hover:bg-surface-active hover:text-fg disabled:opacity-50"
              >
                {item.status === 'active' ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
              </button>
              <button
                type="button"
                disabled={busyId === item.id}
                onClick={() => void updateRecurring(item, 'completed')}
                title={zh ? '停止跟进' : 'Stop following'}
                aria-label={zh ? '停止跟进' : 'Stop following'}
                className="grid size-7 place-items-center rounded-lg text-fg-muted hover:bg-surface-active hover:text-fg disabled:opacity-50"
              >
                <Square className="size-3" aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {openMatter ? (
        <PersonalMatterDialog
          matter={matters.find(m => m.id === openMatter.id) ?? openMatter}
          zh={zh}
          open
          onOpenChange={open => { if (!open) setOpenMatter(null); }}
          onUpdated={next => {
            setOpenMatter(next);
            void mutate();
          }}
          onDeleted={() => {
            setOpenMatter(null);
            void mutate();
          }}
        />
      ) : null}

      {openOneShotId ? (
        <PersonalOneShotFollowUpDialog
          followUpId={openOneShotId}
          open
          onOpenChange={open => { if (!open) setOpenOneShotId(null); }}
          onChanged={() => void mutate()}
        />
      ) : null}
    </section>
  );
}
