import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { ConnectionNeedView } from '@xopcai/gateway-contract';
import { Check, ChevronRight, Link2, Loader2, X } from 'lucide-react';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { InstallConnectorDialog } from '@/features/connectors/components/install-connector-dialog';
import { buildInitialDraft, type InstallDraft } from '@/features/connectors/components/install-connector-draft';
import { fetchStoreConnectorInstallPlan } from '@/features/connectors/connectors-api';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useConnectionWait } from './use-connection-wait';

const copy = {
  zh: { waiting: '等待连接', install: '安装', installing: '正在准备安装', connect: '连接', reconnect: '重新连接', details: '查看详情', skip: '跳过连接', cancel: '取消这个目标',
    ready: '已连接', check: '我已完成授权', authorizing: '等待完成授权', queued: '正在恢复任务',
    scope: '确认后继续', scopeHint: '这个目标已等待了一段时间。请确认仍要按下方原始要求继续；如需修改时间范围，请先在聊天中说明。未读等条件将以实际执行时为准。',
    account: '选择账号', all: '查看全部连接', close: '关闭', intro: '完成连接后，将自动恢复当前目标。你也可以继续发送消息。',
    callbackHint: '远程 Gateway 无法接收本地回调时，粘贴浏览器地址栏中的完整回调 URL。', callbackPlaceholder: '完整回调 URL', callbackSubmit: '完成连接',
    replace: '更换应用', confirmReplace: '确认改用', apps: '个应用需要连接', preserved: '目标已保留', retry: '重试检查', toolsUnavailable: '应用工具暂不可用', toolsHint: '账号已连接，当前无法使用任务所需工具。可以重试检查，无需重新授权。' },
  en: { waiting: 'Waiting for connection', install: 'Install', installing: 'Preparing installation', connect: 'Connect', reconnect: 'Reconnect', details: 'Details', skip: 'Skip connection', cancel: 'Cancel this objective',
    ready: 'Connected', check: 'Check authorization', authorizing: 'Waiting for authorization', queued: 'Resuming task',
    scope: 'Confirm and continue', scopeHint: 'This objective has been waiting for a while. Confirm the original request below, or send a message to change the time range first. Conditions such as unread status are evaluated at execution time.',
    account: 'Choose an account', all: 'View all connections', close: 'Close', intro: 'The current objective resumes automatically after connecting. You can keep sending messages.',
    callbackHint: 'If a remote Gateway cannot receive the local callback, paste the complete callback URL from the browser address bar.', callbackPlaceholder: 'Complete callback URL', callbackSubmit: 'Complete connection',
    replace: 'Change app', confirmReplace: 'Confirm switch to', apps: 'apps need connecting', preserved: 'Objective preserved', retry: 'Retry check', toolsUnavailable: 'App tools unavailable', toolsHint: 'The account is connected, but the tools needed for this task are unavailable. Retry the check without reconnecting.' },
};
const secondary = 'rounded-lg border border-edge px-3 py-1.5 text-sm text-fg hover:bg-surface-hover disabled:opacity-50';
const primary = 'rounded-lg bg-accent px-3 py-1.5 text-sm text-on-accent disabled:opacity-50';

export function ConnectionActionBar({ conversationId }: { conversationId: string }) {
  const { wait, isLoading, busy, error, act } = useConnectionWait(conversationId);
  const [open, setOpen] = useState(false);
  const [replacement, setReplacement] = useState<{ needKey: string; candidateRef: string; label: string }>();
  const [callbackUrls, setCallbackUrls] = useState<Record<string, string>>({});
  const [installDraft, setInstallDraft] = useState<InstallDraft>();
  const [installNeedKey, setInstallNeedKey] = useState<string>();
  const [preparingInstall, setPreparingInstall] = useState(false);
  const [installError, setInstallError] = useState<string>();
  const language = useLocaleStore(state => state.language);
  const t = copy[language];
  if (isLoading) return <Skeleton className="mb-2 h-10 w-full rounded-xl" />;
  if (!wait) return null;
  const first = wait.needs[0];
  const single = wait.needs.length === 1;
  const queued = wait.phase === 'queued';
  const capabilityFailed = wait.needs.some(need => need.capabilityError);
  if (wait.phase === 'ready') return null;
  const mainLabel = queued ? t.queued : wait.phase === 'review_scope' ? t.scope
    : single && first.phase === 'install' ? (preparingInstall ? t.installing : `${t.install} ${first.label}`)
    : single && first.phase === 'connect' ? (language === 'zh' ? `连接 ${first.label}` : `Connect ${first.label}`)
      : single && first.phase === 'reconnect' ? t.reconnect : single && first.phase === 'authorizing' ? t.check : t.details;
  async function prepareStoreInstall(need: ConnectionNeedView = first) {
    if (need.target.type !== 'store-connector') return;
    setPreparingInstall(true);
    setInstallError(undefined);
    try {
      const plan = await fetchStoreConnectorInstallPlan(need.target.packageName, need.target.version);
      if (plan.reviewHash !== need.target.reviewHash
        || plan.definition.id !== need.target.connectorId
        || plan.definition.provenance?.sha256 !== need.target.sha256) {
        throw new Error(language === 'zh' ? 'Connector 包在审查后发生了变化，请重新发起推荐。' : 'The Connector package changed after review. Request a new recommendation.');
      }
      setInstallDraft(buildInitialDraft(plan.definition, {
        packageName: plan.packageName,
        version: plan.version,
        reviewHash: plan.reviewHash,
        permissions: plan.permissions,
      }));
      setInstallNeedKey(need.key);
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreparingInstall(false);
    }
  }
  function primaryAction() {
    if (wait?.phase === 'review_scope') setOpen(true);
    else if (single && first.phase === 'install') void prepareStoreInstall();
    else if (single && ['connect', 'reconnect'].includes(first.phase)) void act('connect', first.key);
    else if (single && first.phase === 'authorizing') void act('check');
    else setOpen(true);
  }
  return <section className="mb-2 rounded-xl border border-edge bg-surface-panel px-3 py-2" aria-label={capabilityFailed ? t.toolsUnavailable : t.waiting}>
    <div className="flex flex-wrap items-center gap-2">
      <Link2 className="size-4 shrink-0 text-accent" aria-hidden />
      <button type="button" className="min-w-0 flex-1 text-left text-sm text-fg" onClick={() => setOpen(true)}>
        {capabilityFailed ? t.toolsUnavailable : single ? `${t.waiting} · ${first.label}` : `${wait.needs.length} ${t.apps}`}
        <ChevronRight className="ml-1 inline size-3" aria-hidden />
      </button>
      <button type="button" className={primary} disabled={busy || queued || preparingInstall} onClick={primaryAction}>
        {busy && <Loader2 className="mr-1 inline size-3 animate-spin" aria-hidden />}{mainLabel}
      </button>
      <button type="button" className="text-xs text-fg-muted hover:text-fg" disabled={busy || queued} onClick={() => void act('skip')}>{t.skip}</button>
    </div>
    {(error || installError) && <p role="alert" className="mt-2 text-xs text-fg-muted">{error ?? installError} <button type="button" className="text-accent" onClick={() => void act('check')}>{t.retry}</button></p>}
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[60] flex h-[min(90dvh,34rem)] w-[min(94vw,34rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-popover outline-none">
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
                    : need.phase === 'install' ? <button type="button" disabled={busy || queued || preparingInstall} className={primary} onClick={() => void prepareStoreInstall(need)}>{t.install}</button>
                      : need.phase !== 'blocked' && need.phase !== 'choose_account' ? <button type="button" disabled={busy || queued} className={primary} onClick={() => void act('connect', need.key)}>{need.phase === 'reconnect' ? t.reconnect : t.connect}</button> : null}
              </div>
              {need.accounts.length > 0 && <PopoverSelect value={need.accountId ?? ''} options={need.accounts.map(account => ({ value: account.id, label: account.label }))}
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
              {need.phase === 'authorizing' && need.target.type === 'plugin-mcp' ? <div className="space-y-2 border-t border-edge pt-2">
                <p className="text-xs text-fg-muted">{t.callbackHint}</p>
                <input type="password" autoComplete="off" value={callbackUrls[need.key] ?? ''} placeholder={t.callbackPlaceholder}
                  className="w-full rounded-lg border border-edge bg-surface-inset px-3 py-2 text-sm text-fg"
                  onChange={event => setCallbackUrls(current => ({ ...current, [need.key]: event.target.value }))} />
                <button type="button" className={secondary} disabled={busy || !(callbackUrls[need.key]?.trim())} onClick={() => {
                  const callbackUrl = callbackUrls[need.key].trim();
                  setCallbackUrls(current => ({ ...current, [need.key]: '' }));
                  void act('submit_callback', need.key, undefined, undefined, callbackUrl);
                }}>{t.callbackSubmit}</button>
              </div> : null}
            </div>)}
            <a href="#/capabilities/connectors" className="text-sm text-accent" onClick={() => setOpen(false)}>{t.all}</a>
          </div>
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-edge p-4">
            <button type="button" disabled={busy || queued} className="text-sm text-fg-muted" onClick={() => void act('cancel')}>{t.cancel}</button>
            {wait.phase === 'review_scope' ? <button type="button" disabled={busy || queued} className={primary}
              onClick={() => void act('confirm_scope')}>{t.scope}</button> : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    {installDraft ? <InstallConnectorDialog
      draft={installDraft}
      onChange={setInstallDraft}
      onClose={() => { setInstallDraft(undefined); setInstallNeedKey(undefined); }}
      onInstalled={async instance => {
        if (!installNeedKey) return;
        const completed = await act('install_complete', installNeedKey, undefined, undefined, undefined, instance.instanceId);
        if (completed) { setInstallDraft(undefined); setInstallNeedKey(undefined); }
      }}
      t={messages(language).connectorsSettings}
    /> : null}
  </section>;
}
