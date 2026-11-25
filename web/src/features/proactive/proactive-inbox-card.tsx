import * as Dialog from '@radix-ui/react-dialog';
import {
  BellOff,
  Check,
  ExternalLink,
  FileEdit,
  Inbox,
  Layers,
  LoaderCircle,
  MessageSquare,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { PopoverSelect, type PopoverSelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { dispatchFillChatComposer } from '@/features/chat/composer/fill-composer-dispatch';
import { formatMediumDateTime } from '@/lib/date-formatters';

import {
  actOnProactiveItem,
  adoptRsiCandidate,
  flushProactiveDigest,
  rollbackRsiCandidate,
  type ProactiveHubMetrics,
  type ProactiveItem,
  type RsiCapabilityCandidate,
} from './proactive-api';

const COPY = {
  zh: {
    sectionTitle: '主动收件箱 · 外部信号',
    tierSBadge: '已同步至对话',
    skillBadge: '能力沉淀建议',
    pulseButton: '脉冲简报与能力库',
    bufferedHint: '待聚合动态',
    reviewDraft: '审阅与处理',
    quickApprove: '直接采纳',
    moveToDigest: '移入简报',
    whyNow: '触发依据与核实事实',
    preparedDraftLabel: '预备草稿 / 候选规格（可直接编辑修改，修改差异将自动用于能力沉淀）',
    approveOriginal: '采纳原方案',
    saveEditAndApprove: '保存修改并执行',
    muteToggle: '静音或降级此类信号',
    muteModeLabel: '后续同类信号处理方式',
    muteModeDrop: '0-Token 直接静默拦截',
    muteModeDigest: '不弹窗，仅归入早晚脉冲简报',
    muteKeywordPlaceholder: '可选：限定标题或发件人关键词',
    applyMuteRule: '应用过滤规则',
    cancel: '关闭',
    drawerTitle: '脉冲简报与自进化能力库',
    tabPulse: '早晚脉冲简报',
    tabRsi: '已沉淀能力 (RSI)',
    flushNow: '立即合成当期简报',
    emptyPulse: '当前没有待读的脉冲简报；低打扰动态将按早晚窗口自动聚合。',
    emptyRsi: '尚无已沉淀的候选或生效能力。修改草稿或排障恢复后将自动提炼。',
    statusAdopted: '已生效',
    statusPending: '待确认',
    statusRolledBack: '已回滚',
    statusRejected: '已拦截',
    adoptBtn: '采纳启用',
    rollbackBtn: '一键回滚',
    resolvedToast: '已更新处理状态',
    discussBtn: '和助手讨论',
    taskStartedNotice: '已批准并启动执行任务',
    openTaskBtn: '查看任务',
  },
  en: {
    sectionTitle: 'Agent Inbox · External Signals',
    tierSBadge: 'In chat',
    skillBadge: 'Skill candidate',
    pulseButton: 'Pulse & Capabilities',
    bufferedHint: 'buffered',
    reviewDraft: 'Review & Edit',
    quickApprove: 'Approve',
    moveToDigest: 'To Digest',
    whyNow: 'Why now & verified facts',
    preparedDraftLabel: 'Prepared draft / specification (edits feed capability learning)',
    approveOriginal: 'Approve as-is',
    saveEditAndApprove: 'Save edits & approve',
    muteToggle: 'Mute or demote similar signals',
    muteModeLabel: 'Future routing rule',
    muteModeDrop: 'Drop silently at Gate 1 (0-Token)',
    muteModeDigest: 'Route to Pulse Digest only',
    muteKeywordPlaceholder: 'Optional subject or sender filter',
    applyMuteRule: 'Apply filter rule',
    cancel: 'Close',
    drawerTitle: 'Pulse Digests & Evolved Capabilities',
    tabPulse: 'Pulse Digests',
    tabRsi: 'Capabilities (RSI)',
    flushNow: 'Synthesize digest now',
    emptyPulse: 'No Pulse digests yet. Non-urgent signals stay quiet until scheduled windows.',
    emptyRsi: 'No evolved capabilities yet. Edits and recovered runs synthesize candidates.',
    statusAdopted: 'Adopted',
    statusPending: 'Pending',
    statusRolledBack: 'Rolled back',
    statusRejected: 'Blocked',
    adoptBtn: 'Adopt',
    rollbackBtn: 'Rollback',
    resolvedToast: 'Action applied',
    discussBtn: 'Discuss',
    taskStartedNotice: 'Approved and started execution task',
    openTaskBtn: 'Open task',
  },
} as const;

export function ProactiveInboxSkeleton() {
  return (
    <div className="space-y-3 rounded-xl bg-surface-panel p-4" aria-busy>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-5 w-32 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-lg" />
      </div>
      <Skeleton className="h-20 rounded-lg" />
    </div>
  );
}

export function ProactiveInboxCard({
  items,
  digests,
  bufferedCount,
  rsiCandidates,
  metrics,
  loading,
  language,
  onReload,
}: {
  items: ProactiveItem[];
  digests: ProactiveItem[];
  bufferedCount: number;
  rsiCandidates: RsiCapabilityCandidate[];
  metrics: ProactiveHubMetrics;
  loading: boolean;
  language: 'zh' | 'en';
  onReload: () => Promise<void>;
}) {
  const c = COPY[language];
  const [selectedItem, setSelectedItem] = useState<ProactiveItem | null>(null);
  const [draftText, setDraftText] = useState('');
  const [muteExpanded, setMuteExpanded] = useState(false);
  const [muteMode, setMuteMode] = useState<'drop' | 'digest_only'>('drop');
  const [muteFilter, setMuteFilter] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'pulse' | 'rsi'>('pulse');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [executedNotice, setExecutedNotice] = useState<{ taskId?: string; summary: string } | null>(null);

  const visibleInboxItems = items.filter((item) => item.category !== 'pulse_digest');
  const hasVisibleContent =
    visibleInboxItems.length > 0
    || bufferedCount > 0
    || digests.length > 0
    || executedNotice !== null
    || rsiCandidates.some((cand) => cand.status === 'adopted' || cand.status === 'inbox_pending');

  if (loading && items.length === 0 && digests.length === 0) {
    return null;
  }
  if (!hasVisibleContent) {
    return null;
  }

  const openItemReview = (item: ProactiveItem) => {
    setSelectedItem(item);
    setDraftText(item.preparedPayload?.preparedDraft ?? '');
    setMuteExpanded(false);
    setMuteMode('drop');
    setMuteFilter('');
    setErrorMsg(null);
  };

  const muteOptions: PopoverSelectOption[] = [
    { value: 'drop', label: c.muteModeDrop },
    { value: 'digest_only', label: c.muteModeDigest },
  ];

  const handleDiscussInPersonal = (item: ProactiveItem) => {
    const prompt = language === 'zh'
      ? `关于「${item.title}」：${item.summary.slice(0, 200)}，帮我一起看看下一步怎么处理。`
      : `Regarding "${item.title}": ${item.summary.slice(0, 200)} — let's review the next step together.`;
    setSelectedItem(null);
    window.location.hash = '#/personal';
    window.setTimeout(() => {
      dispatchFillChatComposer(prompt);
    }, 60);
  };

  const handleQuickApprove = async (item: ProactiveItem) => {
    setBusyId(item.id);
    setErrorMsg(null);
    try {
      const resolved = await actOnProactiveItem(item.id, {
        action: 'approve',
        idempotencyKey: `ui-approve:${item.id}`,
      });
      if (resolved.humanResolution?.executedAction) {
        setExecutedNotice({
          taskId: resolved.humanResolution.executedAction.taskId,
          summary: resolved.humanResolution.executedAction.summary,
        });
      }
      if (selectedItem?.id === item.id) setSelectedItem(null);
      await onReload();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleEditAndApprove = async () => {
    if (!selectedItem) return;
    setBusyId(selectedItem.id);
    setErrorMsg(null);
    try {
      const original = selectedItem.preparedPayload?.preparedDraft ?? '';
      const trimmed = draftText.trim();
      const resolved = trimmed && trimmed !== original.trim()
        ? await actOnProactiveItem(selectedItem.id, {
            action: 'edit_and_approve',
            idempotencyKey: `ui-edit:${selectedItem.id}:${trimmed.length}`,
            editedDraft: trimmed,
          })
        : await actOnProactiveItem(selectedItem.id, {
            action: 'approve',
            idempotencyKey: `ui-approve:${selectedItem.id}`,
          });
      if (resolved.humanResolution?.executedAction) {
        setExecutedNotice({
          taskId: resolved.humanResolution.executedAction.taskId,
          summary: resolved.humanResolution.executedAction.summary,
        });
      }
      setSelectedItem(null);
      await onReload();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleMoveToDigest = async (item: ProactiveItem) => {
    setBusyId(item.id);
    setErrorMsg(null);
    try {
      await actOnProactiveItem(item.id, {
        action: 'move_to_digest',
        idempotencyKey: `ui-digest:${item.id}`,
      });
      if (selectedItem?.id === item.id) setSelectedItem(null);
      await onReload();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleApplyMute = async () => {
    if (!selectedItem) return;
    setBusyId(selectedItem.id);
    setErrorMsg(null);
    try {
      await actOnProactiveItem(selectedItem.id, {
        action: 'mute_rule',
        idempotencyKey: `ui-mute:${selectedItem.id}:${muteMode}`,
        mode: muteMode,
        ...(muteFilter.trim() ? { senderOrSubjectFilter: muteFilter.trim() } : {}),
      });
      setSelectedItem(null);
      await onReload();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleFlushDigest = async () => {
    setBusyId('flush-digest');
    setErrorMsg(null);
    try {
      await flushProactiveDigest();
      await onReload();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleRsiAction = async (candidate: RsiCapabilityCandidate, kind: 'adopt' | 'rollback') => {
    setBusyId(candidate.id);
    setErrorMsg(null);
    try {
      if (kind === 'adopt') await adoptRsiCandidate(candidate.id);
      else await rollbackRsiCandidate(candidate.id);
      await onReload();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      className="min-w-0 rounded-xl bg-surface-panel"
      aria-labelledby="proactive-inbox-heading"
      data-workbench-panel
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-4 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-fg">
            <Inbox className="size-4" aria-hidden />
          </span>
          <h2 id="proactive-inbox-heading" className="text-base font-semibold tracking-tight text-fg">
            {c.sectionTitle}
          </h2>
          {visibleInboxItems.length > 0 ? (
            <span className="rounded-full bg-surface-inset px-2 py-0.5 text-xs font-semibold tabular-nums text-fg-muted">
              {visibleInboxItems.length}
            </span>
          ) : null}
        </div>
        <Button
          variant="ghost"
          className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
          onClick={() => setDrawerOpen(true)}
        >
          <Layers className="size-3.5" aria-hidden />
          <span>{c.pulseButton}</span>
          {bufferedCount > 0 ? (
            <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent-fg">
              {bufferedCount} {c.bufferedHint}
            </span>
          ) : null}
        </Button>
      </div>

      {errorMsg ? (
        <p role="alert" className="mx-4 mb-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger sm:mx-5">
          {errorMsg}
        </p>
      ) : null}

      {executedNotice ? (
        <div role="status" className="mx-4 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge bg-surface-inset px-3 py-2 text-xs text-fg sm:mx-5">
          <span className="min-w-0 truncate">
            {c.taskStartedNotice}：{executedNotice.summary}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {executedNotice.taskId ? (
              <a
                href={`#/tasks/${encodeURIComponent(executedNotice.taskId)}`}
                className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
              >
                {c.openTaskBtn}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => setExecutedNotice(null)}
              aria-label={c.cancel}
              className="rounded p-0.5 text-fg-muted hover:text-fg"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}

      {visibleInboxItems.length > 0 ? (
        <div className="space-y-1.5 px-3 pb-3 sm:px-4">
          {visibleInboxItems.slice(0, 4).map((item) => (
            <article
              key={item.id}
              className="flex flex-col gap-2 rounded-lg border border-edge bg-surface-base/50 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {item.tier === 'tier_s_chat' ? (
                    <span className="rounded-md bg-warning-soft px-1.5 py-0.5 text-[11px] font-medium text-fg">
                      {c.tierSBadge}
                    </span>
                  ) : null}
                  {item.category === 'skill_candidate' ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent-fg">
                      <Sparkles className="size-3" aria-hidden />
                      {c.skillBadge}
                    </span>
                  ) : null}
                  <h3 className="truncate text-sm font-semibold text-fg">{item.title}</h3>
                </div>
                <p className="line-clamp-2 text-xs leading-5 text-fg-muted">{item.summary}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <Button
                  variant="ghost"
                  className="h-8 rounded-lg px-2 text-xs"
                  disabled={busyId !== null}
                  onClick={() => handleDiscussInPersonal(item)}
                >
                  <MessageSquare className="size-3.5" aria-hidden />
                  {c.discussBtn}
                </Button>
                <Button
                  variant="secondary"
                  className="h-8 rounded-lg px-2.5 text-xs"
                  disabled={busyId !== null}
                  onClick={() => openItemReview(item)}
                >
                  <FileEdit className="size-3.5" aria-hidden />
                  {c.reviewDraft}
                </Button>
                <Button
                  variant="primary"
                  className="h-8 rounded-lg px-2.5 text-xs"
                  disabled={busyId !== null}
                  aria-busy={busyId === item.id}
                  onClick={() => void handleQuickApprove(item)}
                >
                  {busyId === item.id
                    ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                    : <Check className="size-3.5" aria-hidden />}
                  {item.proposedAction?.label ?? c.quickApprove}
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="px-4 pb-4 text-xs text-fg-muted sm:px-5">
          {metrics.droppedSignalsTotal > 0
            ? (language === 'zh'
              ? `已静默拦截 ${metrics.droppedSignalsTotal} 条低价值噪音信号。`
              : `Filtered ${metrics.droppedSignalsTotal} low-value background signals.`)
            : null}
        </div>
      )}

      {/* Fixed-size Inline Draft Review & Diff Editor Modal */}
      <Dialog.Root open={selectedItem !== null} onOpenChange={(open) => { if (!open) setSelectedItem(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[90] flex h-[min(38rem,calc(100dvh-1.5rem))] w-[min(44rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay shadow-float focus:outline-none">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-edge px-5 py-4">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="truncate text-base font-semibold text-fg">
                  {selectedItem?.title}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-xs text-fg-muted">
                  {selectedItem
                    ? `${selectedItem.provenance.source} · ${formatMediumDateTime(selectedItem.createdAt, language)}`
                    : ''}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button variant="ghost" className="-mr-2 -mt-1 size-8 shrink-0 rounded-lg p-0" aria-label={c.cancel}>
                  <X className="size-4" aria-hidden />
                </Button>
              </Dialog.Close>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {selectedItem ? (
                <>
                  <p className="text-sm leading-6 text-fg">{selectedItem.summary}</p>

                  <div className="rounded-lg border border-edge bg-surface-inset p-3 text-xs">
                    <p className="font-semibold text-fg">{c.whyNow}</p>
                    <p className="mt-1 text-fg-muted">{selectedItem.provenance.reason}</p>
                    {selectedItem.preparedPayload?.verifiedFacts.length ? (
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-fg-muted">
                        {selectedItem.preparedPayload.verifiedFacts.map((fact) => (
                          <li key={fact}>{fact}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  {selectedItem.preparedPayload?.preparedDraft !== undefined ? (
                    <div className="space-y-1.5">
                      <label htmlFor="proactive-draft-editor" className="block text-xs font-medium text-fg">
                        {c.preparedDraftLabel}
                      </label>
                      <textarea
                        id="proactive-draft-editor"
                        value={draftText}
                        onChange={(e) => setDraftText(e.target.value)}
                        rows={8}
                        className="w-full rounded-lg border border-edge bg-surface-panel p-3 font-mono text-xs leading-5 text-fg focus:border-accent focus:outline-none"
                      />
                    </div>
                  ) : null}

                  <div className="rounded-lg border border-edge p-3">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between text-left text-xs font-medium text-fg-muted hover:text-fg"
                      onClick={() => setMuteExpanded((prev) => !prev)}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <BellOff className="size-3.5" aria-hidden />
                        {c.muteToggle}
                      </span>
                      <span>{muteExpanded ? '−' : '+'}</span>
                    </button>
                    {muteExpanded ? (
                      <div className="mt-3 space-y-3 border-t border-edge pt-3">
                        <div className="space-y-1">
                          <span className="block text-xs text-fg-muted">{c.muteModeLabel}</span>
                          <PopoverSelect
                            value={muteMode}
                            options={muteOptions}
                            placeholder={c.muteModeLabel}
                            allowEmpty={false}
                            ariaLabel={c.muteModeLabel}
                            onChange={(next) => setMuteMode(next === 'digest_only' ? 'digest_only' : 'drop')}
                          />
                        </div>
                        <input
                          type="text"
                          value={muteFilter}
                          onChange={(e) => setMuteFilter(e.target.value)}
                          placeholder={c.muteKeywordPlaceholder}
                          className="h-9 w-full rounded-lg border border-edge bg-surface-panel px-3 text-xs text-fg focus:border-accent focus:outline-none"
                        />
                        <Button
                          variant="secondary"
                          className="h-8 rounded-lg px-3 text-xs"
                          disabled={busyId !== null}
                          onClick={() => void handleApplyMute()}
                        >
                          {c.applyMuteRule}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <Skeleton className="h-40 rounded-lg" />
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-edge px-5 py-3">
              {selectedItem ? (
                <Button
                  variant="ghost"
                  className="h-9 rounded-lg px-3 text-xs"
                  disabled={busyId !== null}
                  onClick={() => void handleMoveToDigest(selectedItem)}
                >
                  {c.moveToDigest}
                </Button>
              ) : <span />}
              <div className="flex items-center gap-2">
                <Dialog.Close asChild>
                  <Button variant="ghost" className="h-9 rounded-lg px-3 text-xs">{c.cancel}</Button>
                </Dialog.Close>
                <Button
                  variant="primary"
                  className="h-9 rounded-lg px-3.5 text-xs"
                  disabled={busyId !== null || !selectedItem}
                  onClick={() => void handleEditAndApprove()}
                >
                  {selectedItem?.preparedPayload?.preparedDraft !== undefined
                    && draftText.trim() !== (selectedItem.preparedPayload.preparedDraft ?? '').trim()
                    ? c.saveEditAndApprove
                    : c.approveOriginal}
                </Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Fixed-size Pulse Digest & RSI Capabilities Drawer Modal */}
      <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[90] flex h-[min(38rem,calc(100dvh-1.5rem))] w-[min(44rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay shadow-float focus:outline-none">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-edge px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">{c.drawerTitle}</Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" className="-mr-2 size-8 rounded-lg p-0" aria-label={c.cancel}>
                  <X className="size-4" aria-hidden />
                </Button>
              </Dialog.Close>
            </div>

            <div className="flex shrink-0 items-center gap-2 border-b border-edge px-5 py-2.5">
              <Button
                variant={drawerTab === 'pulse' ? 'tonal' : 'ghost'}
                className="h-8 rounded-lg px-3 text-xs"
                onClick={() => setDrawerTab('pulse')}
              >
                {c.tabPulse}
              </Button>
              <Button
                variant={drawerTab === 'rsi' ? 'tonal' : 'ghost'}
                className="h-8 rounded-lg px-3 text-xs"
                onClick={() => setDrawerTab('rsi')}
              >
                {c.tabRsi}
              </Button>
              {drawerTab === 'pulse' && bufferedCount > 0 ? (
                <Button
                  variant="primary"
                  className="ml-auto h-8 rounded-lg px-3 text-xs"
                  disabled={busyId !== null}
                  onClick={() => void handleFlushDigest()}
                >
                  {c.flushNow} ({bufferedCount})
                </Button>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {drawerTab === 'pulse' ? (
                digests.length > 0 ? (
                  digests.map((digest) => (
                    <article key={digest.id} className="space-y-2 rounded-lg border border-edge bg-surface-panel p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-fg">{digest.title}</h3>
                        <span className="text-xs text-fg-muted">
                          {formatMediumDateTime(digest.createdAt, language)}
                        </span>
                      </div>
                      <p className="whitespace-pre-line text-xs leading-5 text-fg-muted">{digest.summary}</p>
                    </article>
                  ))
                ) : (
                  <p className="py-8 text-center text-sm text-fg-muted">{c.emptyPulse}</p>
                )
              ) : rsiCandidates.length > 0 ? (
                rsiCandidates.map((cand) => (
                  <article key={cand.id} className="space-y-2 rounded-lg border border-edge bg-surface-panel p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-surface-inset px-2 py-0.5 font-mono text-xs text-fg">
                          {cand.artifactKind}:{cand.targetId}
                          {cand.adoptedVersion ? ` v${cand.adoptedVersion}` : ''}
                        </span>
                        <span className="text-xs text-fg-muted">
                          {cand.status === 'adopted'
                            ? c.statusAdopted
                            : cand.status === 'rolled_back'
                              ? c.statusRolledBack
                              : cand.status === 'rejected'
                                ? c.statusRejected
                                : c.statusPending}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {cand.status === 'inbox_pending' || cand.status === 'staged' ? (
                          <Button
                            variant="primary"
                            className="h-7 rounded-lg px-2.5 text-xs"
                            disabled={busyId !== null}
                            onClick={() => void handleRsiAction(cand, 'adopt')}
                          >
                            {c.adoptBtn}
                          </Button>
                        ) : null}
                        {cand.status === 'adopted' ? (
                          <Button
                            variant="secondary"
                            className="h-7 gap-1 rounded-lg px-2.5 text-xs"
                            disabled={busyId !== null}
                            onClick={() => void handleRsiAction(cand, 'rollback')}
                          >
                            <RotateCcw className="size-3" aria-hidden />
                            {c.rollbackBtn}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-xs leading-5 text-fg">{cand.simRationale.whyChanged}</p>
                    <p className="text-xs text-fg-muted">{cand.simRationale.problemPattern}</p>
                  </article>
                ))
              ) : (
                <p className="py-8 text-center text-sm text-fg-muted">{c.emptyRsi}</p>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
