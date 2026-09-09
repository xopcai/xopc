import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, ChevronRight, Link2, Loader2, X } from 'lucide-react';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';
import { useConnectionWait } from './use-connection-wait';

const copy = {
  zh: { waiting: '等待连接', connect: '连接并继续', reconnect: '重新连接', details: '查看详情', skip: '跳过连接', cancel: '取消这个目标',
    ready: '连接已就绪', continue: '继续', check: '我已完成授权', authorizing: '等待完成授权', queued: '已排队，准备继续',
    scope: '确认后继续', scopeHint: '这个目标已等待了一段时间。请确认仍要按下方原始要求继续；如需修改时间范围，请先在聊天中说明。未读等条件将以实际执行时为准。',
    account: '选择账号', all: '查看全部连接器', close: '关闭', intro: '完成连接后，将继续当前目标。你也可以继续发送消息。',
    replace: '更换应用', confirmReplace: '确认改用', apps: '个应用需要连接', preserved: '目标已保留', retry: '重试检查', toolsUnavailable: '应用工具暂不可用', toolsHint: '账号已连接，当前无法使用任务所需工具。可以重试检查，无需重新授权。' },
  en: { waiting: 'Waiting for connection', connect: 'Connect and continue', reconnect: 'Reconnect', details: 'Details', skip: 'Skip connection', cancel: 'Cancel this objective',
    ready: 'Connection ready', continue: 'Continue', check: 'Check authorization', authorizing: 'Waiting for authorization', queued: 'Queued to continue',
    scope: 'Confirm and continue', scopeHint: 'This objective has been waiting for a while. Confirm the original request below, or send a message to change the time range first. Conditions such as unread status are evaluated at execution time.',
    account: 'Choose an account', all: 'View all connectors', close: 'Close', intro: 'The current objective will continue after connecting. You can keep sending messages.',
    replace: 'Change app', confirmReplace: 'Confirm switch to', apps: 'apps need connecting', preserved: 'Objective preserved', retry: 'Retry check', toolsUnavailable: 'App tools unavailable', toolsHint: 'The account is connected, but the tools needed for this task are unavailable. Retry the check without reconnecting.' },
};
const secondary = 'rounded-lg border border-edge px-3 py-1.5 text-sm text-fg hover:bg-surface-hover disabled:opacity-50';
const primary = 'rounded-lg bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50';

export function ConnectionActionBar({ sessionKey }: { sessionKey: string }) {
  const { wait, isLoading, busy, error, act } = useConnectionWait(sessionKey);
  const [open, setOpen] = useState(false);
  const [replacement, setReplacement] = useState<{ needKey: string; candidateRef: string; label: string }>();
  const language = useLocaleStore(state => state.language);
  const t = copy[language];
  if (isLoading) return <Skeleton className="mb-2 h-10 w-full rounded-xl" />;
  if (!wait) return null;
  const first = wait.needs[0];
  const single = wait.needs.length === 1;
  const queued = wait.phase === 'queued';
  const capabilityFailed = wait.needs.some(need => need.capabilityError);
  const mainLabel = queued ? t.queued : wait.phase === 'ready' ? t.continue : wait.phase === 'review_scope' ? t.scope
    : single && first.phase === 'connect' ? (language === 'zh' ? `连接 ${first.label} 并继续` : `Connect ${first.label} and continue`)
      : single && first.phase === 'reconnect' ? t.reconnect : single && first.phase === 'authorizing' ? t.check : t.details;
  function primaryAction() {
    if (wait?.phase === 'ready') void act('continue');
    else if (wait?.phase === 'review_scope') setOpen(true);
    else if (single && ['connect', 'reconnect'].includes(first.phase)) void act('connect', first.key);
    else if (single && first.phase === 'authorizing') void act('check');
    else setOpen(true);
  }
  return <section className="mb-2 rounded-xl border border-edge bg-surface-panel px-3 py-2" aria-label={capabilityFailed ? t.toolsUnavailable : t.waiting}>
    <div className="flex flex-wrap items-center gap-2">
      <Link2 className="size-4 shrink-0 text-accent" aria-hidden />
      <button type="button" className="min-w-0 flex-1 text-left text-sm text-fg" onClick={() => setOpen(true)}>
        {capabilityFailed ? t.toolsUnavailable : wait.phase === 'ready' ? t.ready : single ? `${t.waiting} · ${first.label}` : `${wait.needs.length} ${t.apps}`}
        <ChevronRight className="ml-1 inline size-3" aria-hidden />
      </button>
      <button type="button" className={primary} disabled={busy || queued} onClick={primaryAction}>
        {busy && <Loader2 className="mr-1 inline size-3 animate-spin" aria-hidden />}{mainLabel}
      </button>
      <button type="button" className="text-xs text-fg-muted hover:text-fg" disabled={busy || queued} onClick={() => void act('skip')}>{t.skip}</button>
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-fg-muted">{error} <button type="button" className="text-accent" onClick={() => void act('check')}>{t.retry}</button></p>}
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[60] flex h-[min(90dvh,34rem)] w-[min(94vw,34rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
          <div className="flex shrink-0 items-center justify-between border-b border-edge px-5 py-4">
            <Dialog.Title className="font-medium text-fg">{t.preserved}</Dialog.Title>
            <Dialog.Close aria-label={t.close}><X className="size-4" /></Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            <Dialog.Description className="text-sm text-fg-muted">{capabilityFailed ? t.toolsHint : wait.phase === 'review_scope' ? t.scopeHint : t.intro}</Dialog.Description>
            <p className="whitespace-pre-wrap rounded-lg border border-edge p-3 text-sm text-fg">{wait.summary}</p>
            <p className="text-xs text-fg-muted">{new Date(wait.objectiveUpdatedAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}</p>
            {wait.timeRange && <p className="text-xs text-fg-muted">{new Date(wait.timeRange.from).toLocaleString(language, { timeZone: wait.timeRange.timezone })} – {new Date(wait.timeRange.to).toLocaleString(language, { timeZone: wait.timeRange.timezone })} ({wait.timeRange.timezone})</p>}
            {wait.needs.map(need => <div key={need.key} className="space-y-2 rounded-xl border border-edge p-3">
              <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-fg">{need.label}{need.accountSelector ? ` · ${need.accountSelector}` : ''}</span>
                {need.capabilityError ? <button type="button" disabled={busy || queued} className={secondary} onClick={() => void act('check')}>{t.retry}</button>
                  : need.phase === 'ready' ? <span className="text-xs text-fg-muted"><Check className="mr-1 inline size-3" />{t.ready}</span>
                  : need.phase === 'authorizing' ? <button type="button" disabled={busy} className={secondary} onClick={() => void act('check')}>{t.check}</button>
                    : need.phase !== 'blocked' && need.phase !== 'choose_account' ? <button type="button" disabled={busy || queued} className={primary} onClick={() => void act('connect', need.key)}>{need.phase === 'reconnect' ? t.reconnect : t.connect}</button> : null}
              </div>
              {need.accounts.length > 0 && <PopoverSelect value={need.connectionId ?? ''} options={need.accounts.map(account => ({ value: account.id, label: account.label }))}
                placeholder={t.account} ariaLabel={`${need.label}: ${t.account}`} allowEmpty={false} disabled={busy || queued} onChange={id => void act('select_account', need.key, id)} />}
              {need.alternatives?.length ? <div className="space-y-2">
                <PopoverSelect value={replacement?.needKey === need.key ? replacement.candidateRef : ''}
                  options={need.alternatives.map(item => ({ value: item.candidateRef, label: item.label }))}
                  placeholder={t.replace} ariaLabel={`${need.label}: ${t.replace}`} disabled={busy || queued} allowEmpty={false}
                  onChange={id => setReplacement({ needKey: need.key, candidateRef: id, label: need.alternatives!.find(item => item.candidateRef === id)!.label })} />
                {replacement?.needKey === need.key && <button type="button" className={secondary} disabled={busy}
                  onClick={() => { void act('replace_source', need.key, undefined, replacement.candidateRef); setReplacement(undefined); }}>{t.confirmReplace} {replacement.label}</button>}
              </div> : null}
              {need.reason && <p className="text-xs text-fg-muted">{need.reason}</p>}
              {need.phase === 'authorizing' && <div className="flex items-center justify-between text-xs text-fg-muted"><span>{t.authorizing}</span><button type="button" disabled={busy} className="text-accent" onClick={() => void act('connect', need.key)}>{t.reconnect}</button></div>}
            </div>)}
            <a href="#/connectors" className="text-sm text-accent" onClick={() => setOpen(false)}>{t.all}</a>
          </div>
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-edge p-4">
            <button type="button" disabled={busy || queued} className="text-sm text-fg-muted" onClick={() => void act('cancel')}>{t.cancel}</button>
            <button type="button" disabled={busy || queued || !['ready', 'review_scope'].includes(wait.phase)} className={primary}
              onClick={() => void act(wait.phase === 'review_scope' ? 'confirm_scope' : 'continue')}>{wait.phase === 'review_scope' ? t.scope : t.continue}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </section>;
}
