import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertTriangle,
  CheckCircle2,
  FolderKanban,
  Globe,
  ListTodo,
  LoaderCircle,
  MessageSquare,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { dispatchFillChatComposer } from '@/features/chat/composer/fill-composer-dispatch';
import { cn } from '@/lib/cn';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import type { PersonalMatterItem } from './personal-following';
import { formatPersonalScheduleTime } from './personal-task-time';

function matterStatusBadge(status: PersonalMatterItem['status'], zh: boolean): { label: string; className: string } {
  switch (status) {
    case 'waiting_user':
      return { label: zh ? '待你拍板' : 'Needs decision', className: 'bg-warning-soft text-fg' };
    case 'paused':
      return { label: zh ? '已暂停' : 'Paused', className: 'bg-surface-inset text-fg-muted' };
    case 'resolved':
      return { label: zh ? '已解决' : 'Resolved', className: 'bg-surface-inset text-fg-muted' };
    case 'expired':
      return { label: zh ? '已到期' : 'Expired', className: 'bg-surface-inset text-fg-muted' };
    default:
      return { label: zh ? '持续跟进中' : 'Following', className: 'bg-accent-soft text-accent-fg' };
  }
}

function bindingIcon(kind: PersonalMatterItem['bindings'][number]['kind']) {
  switch (kind) {
    case 'web_url':
      return Globe;
    case 'event_source':
      return Radio;
    case 'web_search':
      return Search;
    case 'task':
      return ListTodo;
    case 'project':
      return FolderKanban;
  }
}

function bindingLabel(binding: PersonalMatterItem['bindings'][number], zh: boolean): string {
  switch (binding.kind) {
    case 'web_url':
      return binding.label || binding.url;
    case 'event_source':
      return `${binding.label}${binding.keyword ? ` · ${binding.keyword}` : ''}${binding.sender ? ` · ${binding.sender}` : ''}`;
    case 'web_search':
      return `${zh ? '搜索' : 'Search'}: ${binding.query}`;
    case 'task':
      return `${zh ? '关联任务' : 'Task'}${binding.label ? ` · ${binding.label}` : ''}`;
    case 'project':
      return `${zh ? '关联项目' : 'Project'}${binding.label ? ` · ${binding.label}` : ''}`;
  }
}

export function PersonalMatterDialog({
  matter,
  zh,
  open,
  onOpenChange,
  onUpdated,
  onDeleted,
}: {
  matter: PersonalMatterItem;
  zh: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (next: PersonalMatterItem) => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState<'check' | 'pause' | 'resolve' | 'delete' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const badge = matterStatusBadge(matter.status, zh);
  const language = zh ? 'zh' : 'en';
  const isClosed = matter.status === 'resolved' || matter.status === 'expired';

  const handleCheckNow = async () => {
    setBusy('check');
    setErrorMsg(null);
    try {
      const res = await fetchJson<{ payload: PersonalMatterItem }>(
        apiUrl(`/api/personal-agent/matters/${encodeURIComponent(matter.id)}/check`),
        { method: 'POST' },
      );
      onUpdated(res.payload);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleStatusChange = async (status: 'active' | 'paused' | 'resolved', kind: 'pause' | 'resolve') => {
    setBusy(kind);
    setErrorMsg(null);
    try {
      const res = await fetchJson<{ payload: PersonalMatterItem }>(
        apiUrl(`/api/personal-agent/matters/${encodeURIComponent(matter.id)}`),
        {
          method: 'PATCH',
          body: JSON.stringify({ expectedRevision: matter.revision, status }),
        },
      );
      onUpdated(res.payload);
      if (status === 'resolved') onOpenChange(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    setBusy('delete');
    setErrorMsg(null);
    try {
      await fetchJson(apiUrl(`/api/personal-agent/matters/${encodeURIComponent(matter.id)}`), {
        method: 'DELETE',
      });
      onOpenChange(false);
      onDeleted();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDiscuss = () => {
    const prompt = zh
      ? `关于我正在跟进的「${matter.title}」（最新进展：${matter.lastSummary}），帮我一起看看下一步。`
      : `Regarding my follow-up "${matter.title}" (latest: ${matter.lastSummary}), let's review the next step.`;
    onOpenChange(false);
    window.location.hash = '#/personal';
    window.setTimeout(() => dispatchFillChatComposer(prompt), 60);
  };

  return (
    <Dialog.Root open={open} onOpenChange={next => { if (!next && !busy) onOpenChange(false); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[90] flex h-[min(38rem,calc(100dvh-2rem))] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-popover focus:outline-none">
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-edge px-5 py-4">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-medium', badge.className)}>
                  {badge.label}
                </span>
                <Dialog.Title className="truncate text-base font-semibold text-fg">
                  {matter.title}
                </Dialog.Title>
              </div>
              <Dialog.Description className="line-clamp-2 text-xs leading-5 text-fg-muted">
                {matter.goal}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" className="-mr-2 -mt-1 size-8 shrink-0 rounded-lg p-0" disabled={busy !== null} aria-label={zh ? '关闭' : 'Close'}>
                <X className="size-4" aria-hidden />
              </Button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
            {errorMsg ? (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
                {errorMsg}
              </p>
            ) : null}

            {matter.lastError ? (
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft/50 px-3 py-2.5 text-xs text-fg">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <span>{matter.lastError}</span>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3 rounded-xl border border-edge bg-surface-panel p-3.5 text-xs">
              <div className="col-span-2">
                <p className="text-fg-muted">{zh ? '什么情况值得找我' : 'Notify me when'}</p>
                <p className="mt-0.5 text-fg">{matter.notifyWhen}</p>
              </div>
              {matter.doneCriteria ? (
                <div className="col-span-2">
                  <p className="text-fg-muted">{zh ? '结束条件' : 'Done criteria'}</p>
                  <p className="mt-0.5 text-fg">{matter.doneCriteria}</p>
                </div>
              ) : null}
              <div>
                <p className="text-fg-muted">{zh ? '上次检查' : 'Last checked'}</p>
                <p className="mt-0.5 font-medium text-fg">
                  {matter.lastCheckedAt ? formatPersonalScheduleTime(matter.lastCheckedAt, zh) : (zh ? '等待首次检查' : 'Pending')}
                </p>
              </div>
              <div>
                <p className="text-fg-muted">{zh ? '下次计划检查' : 'Next check'}</p>
                <p className="mt-0.5 font-medium text-fg">
                  {matter.nextCheckAt ? formatPersonalScheduleTime(matter.nextCheckAt, zh) : (zh ? '已暂停或结束' : 'None')}
                </p>
              </div>
              {matter.deadlineAt ? (
                <div className="col-span-2">
                  <p className="text-fg-muted">{zh ? '截止时间' : 'Deadline'}</p>
                  <p className="mt-0.5 font-medium text-fg">{formatMediumDateTime(matter.deadlineAt, language)}</p>
                </div>
              ) : null}
            </div>

            {matter.bindings.length > 0 ? (
              <section className="space-y-1.5">
                <h4 className="text-xs font-semibold text-fg-muted">
                  {zh ? '已接入的检查来源' : 'Connected sources'}
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {matter.bindings.map((binding, idx) => {
                    const Icon = bindingIcon(binding.kind);
                    const text = bindingLabel(binding, zh);
                    return binding.kind === 'web_url' ? (
                      <a
                        key={`${binding.kind}-${idx}`}
                        href={binding.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 py-1 text-xs text-fg hover:border-accent/50"
                      >
                        <Icon className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
                        <span className="truncate">{text}</span>
                      </a>
                    ) : (
                      <span
                        key={`${binding.kind}-${idx}`}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 py-1 text-xs text-fg"
                      >
                        <Icon className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
                        <span className="truncate">{text}</span>
                      </span>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section className="space-y-2">
              <h4 className="text-xs font-semibold text-fg-muted">
                {zh ? '跟进时间线' : 'Progress timeline'}
              </h4>
              <ol className="space-y-2">
                {matter.progressLog.map(entry => (
                  <li key={entry.id} className="rounded-xl border border-edge bg-surface-panel/70 px-3 py-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2 text-fg-subtle">
                      <span className="font-medium text-fg-muted">
                        {entry.kind === 'check_silent'
                          ? (zh ? '静默核查 · 暂无新变化' : 'Quiet check · no material change')
                          : entry.kind === 'action_proposed'
                            ? (zh ? '已备好方案 · 待拍板' : 'Action proposed')
                            : entry.kind === 'update_sent'
                              ? (zh ? '已主动汇报进展' : 'Update sent')
                              : entry.kind === 'resolved'
                                ? (zh ? '已解决收口' : 'Resolved')
                                : entry.kind === 'blocked'
                                  ? (zh ? '来源受阻' : 'Source blocked')
                                  : entry.kind === 'user_note'
                                    ? (zh ? '你的补充' : 'Your note')
                                    : (zh ? '状态更新' : 'Status')}
                      </span>
                      <time dateTime={new Date(entry.at).toISOString()}>
                        {formatMediumDateTime(entry.at, language)}
                      </time>
                    </div>
                    <p className="mt-1 leading-5 text-fg">{entry.summary}</p>
                    {entry.preparedDraft ? (
                      <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-inset p-2 font-mono text-[11px] leading-4 text-fg-muted">
                        {entry.preparedDraft}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-edge px-5 py-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {!isClosed ? (
                <>
                  <Button
                    type="button"
                    variant="primary"
                    className="h-8 gap-1.5 rounded-lg px-3 text-xs"
                    disabled={busy !== null}
                    onClick={() => void handleCheckNow()}
                  >
                    {busy === 'check'
                      ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                      : <RefreshCw className="size-3.5" aria-hidden />}
                    {zh ? '立即查一次' : 'Check now'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 gap-1 rounded-lg px-2.5 text-xs"
                    disabled={busy !== null}
                    onClick={() => void handleStatusChange(matter.status === 'paused' ? 'active' : 'paused', 'pause')}
                  >
                    {matter.status === 'paused' ? <Play className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
                    {matter.status === 'paused' ? (zh ? '恢复' : 'Resume') : (zh ? '暂停' : 'Pause')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 gap-1 rounded-lg px-2.5 text-xs"
                    disabled={busy !== null}
                    onClick={() => void handleStatusChange('resolved', 'resolve')}
                  >
                    <CheckCircle2 className="size-3.5" aria-hidden />
                    {zh ? '标记已解决' : 'Resolve'}
                  </Button>
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                className="h-8 gap-1 rounded-lg px-2.5 text-xs"
                disabled={busy !== null}
                onClick={handleDiscuss}
              >
                <MessageSquare className="size-3.5" aria-hidden />
                {zh ? '去对话聊' : 'Discuss'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="size-8 rounded-lg p-0 text-fg-muted hover:text-danger"
                disabled={busy !== null}
                aria-label={zh ? '删除事项' : 'Delete matter'}
                title={zh ? '删除事项' : 'Delete matter'}
                onClick={() => void handleDelete()}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
